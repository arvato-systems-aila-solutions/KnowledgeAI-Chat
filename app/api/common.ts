import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";

export const OPENAI_URL = "api.openai.com";
const DEFAULT_PROTOCOL = "https";
const PROTOCOL = process.env.PROTOCOL || DEFAULT_PROTOCOL;
const BASE_URL = process.env.BASE_URL || OPENAI_URL;
const DISABLE_GPT4 = !!process.env.DISABLE_GPT4;

export async function requestOpenai(req: NextRequest) {
  const config = getServerSideConfig();
  const controller = new AbortController();
  const openaiPath = `${req.nextUrl.pathname}${req.nextUrl.search}`.replaceAll(
    "/api/openai/",
    "",
  );

  let authValue = req.headers.get("Authorization") ?? "";
  let baseUrl = BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `${PROTOCOL}://${baseUrl}`;
  }

  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", openaiPath);
  console.log("[Base Url]", baseUrl);

  if (process.env.OPENAI_ORG_ID) {
    console.log("[Org ID]", process.env.OPENAI_ORG_ID);
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10 * 180 * 1000);

  let fetchUrl: string;
  if (config.openaiOnAzure === "1") {
    const deploymentId = config.azureDeploymentId;
    const apiVersion = config.azureApiVersion;
    fetchUrl = `${baseUrl}/openai/deployments/${deploymentId}/chat/completions?api-version=${apiVersion}`;
  } else {
    fetchUrl = `${baseUrl}/${openaiPath}`;
  }

  let avviaKey = req.headers.get("x-avvia-key")
  if (avviaKey) {
    authValue = avviaKey;
  }

  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "api-key": config.apiKey ? config.apiKey : "",
      Authorization: authValue,
      ...(process.env.OPENAI_ORG_ID && {
        "OpenAI-Organization": process.env.OPENAI_ORG_ID,
      }),
    },
    method: req.method,
    body: req.body,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    let resp = new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });

    if (res.status !== 200) {
      return NextResponse.json(
          {
            error: true,
            message: "Avvia Intelligence Error " + res.status + ": " + res.statusText,
          },
          {
            status: 500,
          },
        );
    } else {
      return resp;
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
