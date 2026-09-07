let csrf = "";
export async function api(path: string, method = "GET", body?: any) {
  const multipart = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(method !== "GET" ? { "X-Forge-CSRF": csrf } : {}),
    },
    ...(body !== undefined
      ? { body: multipart ? body : JSON.stringify(body) }
      : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  if (result.csrf) csrf = result.csrf;
  return result;
}
