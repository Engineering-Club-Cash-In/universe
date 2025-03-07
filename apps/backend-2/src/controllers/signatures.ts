export async function sendSignatureRequest(
  templateId: number,
  emails: string[]
): Promise<any> {
  const url = "https://docuseal.devteamatcci.site/api/submissions/emails";
  const authToken = "8WQFcgtwWWX2PVZDP3GiEHpgz6qLfSSgB1K9xpXq3yY";
  const data = {
    template_id: templateId,
    emails: emails.join(", "),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseData = await response.json();
    return responseData;
  } catch (error) {
    console.error("Error sending signature request:", error);
    throw error; // Re-throw the error to be handled by the caller
  }
}
