import type { Config, Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sourceUrl = new URL(req.url).searchParams.get("url");
  if (!sourceUrl) {
    return new Response("Missing URL parameter", { status: 400 });
  }

  try {
    const response = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://weread.qq.com/"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch cover. Status: ${response.status}`);
    }

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (error: any) {
    return new Response(error?.message || "Failed to load cover image", { status: 500 });
  }
};

export const config: Config = {
  path: "/api/weread/proxy-cover"
};
