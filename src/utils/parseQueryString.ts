export default function parseQueryString(url: string) {
  const queryString = url.split("?")[1];
  const queryParams: Record<string, string> = {};
  queryString?.split("&").forEach(item => {
    const [key, value] = item.split("=");
    queryParams[key] = value;
  })
  return queryParams;
}