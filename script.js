const SPECIALTIES = {
  'AIMM': { specialty: 'Allergy and Immunology', subs: [] },
  'ANES': { specialty: 'Anesthesiology', subs: ['Critical Care Medicine', 'Hospice and Palliative Medicine', 'Pain Medicine', 'Sleep Medicine'] },
  'CARD': { specialty: 'Cardiology', subs: ['Interventional Cardiology'] },
  // ... add other specialties
};

let previousData;
const loadingSpinner = `<div class="spinner-border spinner-border-sm" role="status">
    <span class="visually-hidden">Loading...</span>
  </div>`;

async function handleSubmit() {
  const url = document.getElementById('url').value;
  const text = document.getElementById('text').value;
  const file = document.getElementById('file').files[0];
  const analyzeBtn = document.getElementById('analyze');
  const results = document.getElementById('results');
  const feedback = document.getElementById('feedback');
  try {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = loadingSpinner + ' Processing...';
    results.classList.add('d-none');

    let content = '';
    if (url) {
      const response = await fetch(`https://llmfoundry.straive.com/-/markdown?n=1&url=${encodeURIComponent(url)}`);
      content = await response.text();
    } else if (text) {
      content = text;
    } else if (file) {
      if (file.type === 'application/pdf') {
        const pdfData = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
        const maxPages = pdf.numPages;
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          content += textContent.items.map(item => item.str).join(' ');
        }
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const docxData = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: docxData });
        content = result.value;
      } else {
        content = await file.text();
      }
    } else {
      throw new Error('Please provide content via URL, text, or file upload');
    }
    const analysis = await analyzeContent(content);
    displayResults(analysis);
    if (feedback.classList.contains('d-none')) feedback.classList.remove('d-none');
    // saveToLocalStorage(analysis);

  } catch (error) {
    //console.error(error.message);
    alert('Error: ' + error.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<i class="bi bi-play"></i> Analyze Content';
  }
}

async function analyzeContent(content) {
  const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a medical content tagging expert. Analyze the content and generate:
              1. Give me top 6 Medical concept tags with confidence scores (0-1)
              2. ICD-10 codes with descriptions and confidence scores (0-1)
              3. MeSH terms with codes and confidence scores (0-1)
              4. Specialty tags matching the provided hierarchy
              5. Crosswalk between ICD-10 and MeSH codes with confidence scores (0-1)

              Return JSON format: {
                tags: [{text: string, confidence: number}],
                icd10: [{code: string, description: string, confidence: number}],
                mesh: [{term: string, code: string, confidence: number}],
                specialties: [{code: string, specialty: string, subspecialty: string}],
                crosswalk: [{icd10: string, mesh: string, confidence: number}]
              }`
        },
        { role: "user", content: content }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error('Failed to analyze content');
  }

  const result = await response.json();
  previousData = JSON.parse(result.choices[0].message.content);
  // console.log("Data From First Iteration : ", previousData);
  return previousData;
}

async function handleFeedback() {
  const question = document.getElementById('sme-question').value;
  const submitFeedbackBtn = document.getElementById('submit-feedback');
  const feedbackResponse = document.getElementById('feedback-response');

  if (!question.trim()) {
    alert('Please enter a question or feedback');
    return;
  }

  try {
    submitFeedbackBtn.disabled = true;
    submitFeedbackBtn.innerHTML = loadingSpinner + ' Submitting...';
    feedbackResponse.innerHTML = '';
    // console.log("Before DataUpdated : ", previousData);
    // Send SME question to LLM
    const response = await fetch("https://llmfoundry.straive.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system", content: `You are a Medical Expert. You are assisting SMEs in evaluating medical content tagging results.
Analyze the feedback provided by the user and perform one of the following actions:
Take ${JSON.stringify(previousData)} as your primary data to work on.
1. **Update the Data:**
- If the feedback applies to a specific field or entry, retain ${JSON.stringify(previousData)} and only make changes whereever needed/asked to.
- If the feedback specifies a complete update, replace the entire dataset.
- Review all the tags and make necessary changes.
- Return the updated data along with an explanation of the changes.
- In these cases isValid will be true.

2. **Provide Explanation Only:**
- If the SME explicitly asks for an explanation or detail, provide detailed reasoning or analysis based on the feedback without making changes to the ${JSON.stringify(previousData)}.isValid in this case will be false.
- Do not explain why the data was not updated unless the SME’s feedback challenges the validity of the existing data.

3. **Defend Existing Data (if challenged):**
- If the SME's feedback disputes the data's accuracy but does not warrant changes, provide an explanation defending why the data remains valid.

The response format should be in json format without any comments:
{
"correctedData": { },
"isValid": true/false,
"explanation": "Details about the changes or why no changes were made"
}}

` },
          { role: "user", content: `Question or feedback: ${question}` }
        ]
      })
    });

    if (!response.ok) {
      throw new Error('Failed to process SME feedback');
    }

    //console.log(response);
    const result = await response.json();
    // console.log(result);
    const feedbackAnalysis = JSON.parse(result.choices[0].message.content);
    //console.log("feedbackAnalysis : ", feedbackAnalysis);
    //console.log("Corrected Data : ", feedbackAnalysis.correctedData);
    previousData = { ...previousData, ...feedbackAnalysis.correctedData };
    // console.log("After DataUpdated : ", previousData);
    if (feedbackAnalysis.isValid) {
      // Feedback is valid; re-render data with corrected results
      displayResults(previousData);

      feedbackResponse.innerHTML = `
    <div class="alert alert-success">
      Feedback accepted. The data has been updated as per SME suggestions.
    </div>
    <p>${feedbackAnalysis.explanation}</p>`;
    } else {
      // Feedback is invalid; LLM defends its choice
      feedbackResponse.innerHTML = `
    <div class="alert alert-info">
      LLM maintains the original results.
    </div>
    <p>${feedbackAnalysis.explanation}</p>`;
    }

  } catch (error) {
    console.error(error.message);
    alert('Error: ' + error.message);
  } finally {
    submitFeedbackBtn.disabled = false;
    submitFeedbackBtn.innerHTML = '<i class="bi bi-send"></i> Submit Feedback';
  }
}

function displayResults(analysis) {
  document.getElementById('results').classList.remove('d-none');

  document.getElementById('tags').innerHTML = analysis.tags
    .map(t => `<tr>
        <td>${t.text}</td>
        <td><div class="progress">
          <div class="progress-bar" role="progressbar" style="width: ${t.confidence * 100}%"
               aria-valuenow="${t.confidence * 100}" aria-valuemin="0" aria-valuemax="100">
            ${(t.confidence * 100).toFixed(0)}%
          </div>
        </div></td>
      </tr>`).join('');

  document.getElementById('icd10').innerHTML = analysis.icd10
    .map(i => `<tr>
        <td><code>${i.code}</code></td>
        <td>${i.description}</td>
        <td><div class="progress">
          <div class="progress-bar" role="progressbar" style="width: ${i.confidence * 100}%"
               aria-valuenow="${i.confidence * 100}" aria-valuemin="0" aria-valuemax="100">
            ${(i.confidence * 100).toFixed(0)}%
          </div>
        </div></td>
      </tr>`).join('');

  document.getElementById('mesh').innerHTML = analysis.mesh
    .map(m => `<tr>
        <td>${m.term}</td>
        <td><code>${m.code}</code></td>
        <td><div class="progress">
          <div class="progress-bar" role="progressbar" style="width: ${m.confidence * 100}%"
               aria-valuenow="${m.confidence * 100}" aria-valuemin="0" aria-valuemax="100">
            ${(m.confidence * 100).toFixed(0)}%
          </div>
        </div></td>
      </tr>`).join('');

  document.getElementById('specialties').innerHTML = analysis.specialties
    .map(s => `<tr>
        <td><code>${s.code}</code></td>
        <td>${s.specialty}</td>
        <td>${s.subspecialty || '-'}</td>
      </tr>`).join('');

  document.getElementById('crosswalk').innerHTML = analysis.crosswalk
    .map(c => `<tr>
        <td><code>${c.icd10}</code></td>
        <td><code>${c.mesh}</code></td>
        <td><div class="progress">
          <div class="progress-bar" role="progressbar" style="width: ${c.confidence * 100}%"
               aria-valuenow="${c.confidence * 100}" aria-valuemin="0" aria-valuemax="100">
            ${(c.confidence * 100).toFixed(0)}%
          </div>
        </div></td>
      </tr>`).join('');
}
// Attach the event listener to the feedback button
document.getElementById('submit-feedback').addEventListener('click', handleFeedback);
document.getElementById('analyze').addEventListener('click', handleSubmit);