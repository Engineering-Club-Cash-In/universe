export const urlToFile = async (url: string) => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], url.split("/").pop() || "file", {
    type: response.headers.get("content-type") || "application/octet-stream",
  });
};
