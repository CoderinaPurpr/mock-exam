// app.js (MVP)
// NOTE: We will expand this later to collect real answers.
// For now it supports lead storage + a test submission call.

export function getOrCreateSubmissionId() {
  let id = localStorage.getItem("mock_submission_id");
  if (!id) {
    id = "sub_" + crypto.randomUUID();
    localStorage.setItem("mock_submission_id", id);
  }
  return id;
}

export function getSavedLead() {
  try {
    return JSON.parse(localStorage.getItem("mock_lead") || "null");
  } catch {
    return null;
  }
}

export async function submitMvp() {
  const submission_id = getOrCreateSubmissionId();
  const lead = getSavedLead();
  if (!lead) throw new Error("Missing lead. Go back to the start page.");

  const res = await fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      submission_id,
      lead,
      answers: {
        reading: {},
        listening: {},
        writing: {},
      },
    }),
  });

  const text = await res.text();
  return { 
    status: res.status, 
    text,
   };
}
