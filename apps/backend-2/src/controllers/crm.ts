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

    const response = await fetch("https://crm.devteamatcci.site/rest/people", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMTI4Zjk5ZS00ZjM0LTQwN2MtYmQ0Yy0xYzU4M2UyZTU4NjQiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiZDEyOGY5OWUtNGYzNC00MDdjLWJkNGMtMWM1ODNlMmU1ODY0IiwiaWF0IjoxNzQxNzA1ODExLCJleHAiOjQ4OTUzMDU4MTAsImp0aSI6ImExZGIyMGIwLTlkNjYtNDUyZS1iMzVhLWRjMzVjODM0ZjA0YSJ9.61VQues2Jj3AtikcdYvqNSX1tTNPQlPiE1mu8Z1GcCA",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    return response.json();
  } catch (error) {
    console.error("Error creating CRM person:", error);
    throw error;
  }
}

export async function createOpportunity(
  personId: string,
  opportunityName: string,
  opportunityAmount: number,
  companyId?: string
) {
  try {
    const data = {
      amount: {
        amountMicros: opportunityAmount * 1000000, // Convert to micros
        currencyCode: "GTQ",
      },
      name: opportunityName,
      closeDate: new Date().toISOString(),
      stage: "NEW",
      position: 0,
      createdBy: {
        source: "EMAIL",
      },
      pointOfContactId: personId,
      companyId: companyId || null,
    };

    const response = await fetch(
      "https://crm.devteamatcci.site/rest/opportunities",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMTI4Zjk5ZS00ZjM0LTQwN2MtYmQ0Yy0xYzU4M2UyZTU4NjQiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiZDEyOGY5OWUtNGYzNC00MDdjLWJkNGMtMWM1ODNlMmU1ODY0IiwiaWF0IjoxNzQxNzA1ODExLCJleHAiOjQ4OTUzMDU4MTAsImp0aSI6ImExZGIyMGIwLTlkNjYtNDUyZS1iMzVhLWRjMzVjODM0ZjA0YSJ9.61VQues2Jj3AtikcdYvqNSX1tTNPQlPiE1mu8Z1GcCA",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    return response.json();
  } catch (error) {
    console.error("Error creating opportunity:", error);
    throw error;
  }
}

export async function createTask(
  title: string,
  body: string,
  dueAt: Date,
  assigneeId: string = "f81dd5cd-3335-4f95-bf51-c58069d55b16",
  status: string = "TODO"
) {
  try {
    const data = {
      position: 0,
      title,
      body,
      bodyV2: {
        blocknote: body,
        markdown: body,
      },
      dueAt: dueAt.toISOString(),
      status,
      createdBy: {
        source: "EMAIL",
      },
      assigneeId,
    };

    const response = await fetch("https://crm.devteamatcci.site/rest/tasks", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMTI4Zjk5ZS00ZjM0LTQwN2MtYmQ0Yy0xYzU4M2UyZTU4NjQiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiZDEyOGY5OWUtNGYzNC00MDdjLWJkNGMtMWM1ODNlMmU1ODY0IiwiaWF0IjoxNzQxNzA1ODExLCJleHAiOjQ4OTUzMDU4MTAsImp0aSI6ImExZGIyMGIwLTlkNjYtNDUyZS1iMzVhLWRjMzVjODM0ZjA0YSJ9.61VQues2Jj3AtikcdYvqNSX1tTNPQlPiE1mu8Z1GcCA",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    return response.json();
  } catch (error) {
    console.error("Error creating task:", error);
    throw error;
  }
}

export async function createVehicle(
  name: string,
  marca: string,
  modelo: string,
  ano: number,
  nombreRevisor: { firstName: string; lastName: string } = {
    firstName: "Técnico",
    lastName: "Revisor",
  },
  detalles: Record<string, any> = {}
) {
  try {
    const data = {
      name,
      createdBy: {
        source: "EMAIL",
      },
      position: 0,
      nombreRevisor,
      marca,
      modelo,
      ano,
      detalles,
    };

    const response = await fetch(
      "https://crm.devteamatcci.site/rest/vehiculos",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization:
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkMTI4Zjk5ZS00ZjM0LTQwN2MtYmQ0Yy0xYzU4M2UyZTU4NjQiLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiZDEyOGY5OWUtNGYzNC00MDdjLWJkNGMtMWM1ODNlMmU1ODY0IiwiaWF0IjoxNzQxNzA1ODExLCJleHAiOjQ4OTUzMDU4MTAsImp0aSI6ImExZGIyMGIwLTlkNjYtNDUyZS1iMzVhLWRjMzVjODM0ZjA0YSJ9.61VQues2Jj3AtikcdYvqNSX1tTNPQlPiE1mu8Z1GcCA",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      }
    );

    return response.json();
  } catch (error) {
    console.error("Error creating vehicle:", error);
    throw error;
  }
}
