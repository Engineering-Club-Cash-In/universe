export async function createCrmPerson(
  firstName: string,
  lastName: string,
  email: string,
  city: string,
  avatarUrl: string
) {
  try {
    const data = {
      name: {
        firstName: firstName,
        lastName: lastName,
      },
      emails: {
        primaryEmail: email,
        additionalEmails: [email],
      },
      phones: {
        primaryPhoneNumber: "502 5555 5555",
      },
      city: city,
      avatarUrl: avatarUrl,
      createdBy: {
        source: "EMAIL",
      },
    };

    const response = await fetch(
      "https://crm.server.devteamatcci.site/rest/people",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJlNWU3ZDhhYy0wOTYwLTRkZTgtODY5Mi0zOWRhM2VmZWViNTgiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiZTVlN2Q4YWMtMDk2MC00ZGU4LTg2OTItMzlkYTNlZmVlYjU4IiwiaWF0IjoxNzM5NDA1ODAxLCJleHAiOjQ4OTMwMDU4MDAsImp0aSI6IjE4NjZhM2QyLTgzZjItNGMxMy1hNzlhLTE2ZWYzZTczOTA3MSJ9.JaDKn2YSDOtZGn8kLhIZzD9RUJw-DuJ9r3PqXa3Tyjk",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    return response.json();
  } catch (error) {
    console.error("Error creating CRM person:", error);
    throw error;
  }
}
