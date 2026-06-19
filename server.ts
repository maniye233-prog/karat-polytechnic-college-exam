import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Body parser middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Lazy initializer for Google GenAI client
let genAIClient: GoogleGenAI | null = null;
function getGenAI() {
  if (!genAIClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("Warning: GEMINI_API_KEY is missing. Using placeholder key.");
    }
    genAIClient = new GoogleGenAI({
      apiKey: apiKey || "MOCK_KEY",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return genAIClient;
}

// Model alias from system instructions (Basic text & json tasks = gemini-3.5-flash)
const MODEL_NAME = "gemini-3.5-flash";

// 1. Endpoint: Generate Questions with Gemini API
app.post("/api/gemini/generate-questions", async (req, res) => {
  try {
    const { topic, category, quantity = 5, type = "all", difficulty = "medium", tags = [] } = req.body;
    
    const client = getGenAI();
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
      // Return beautiful mock questions if no API Key provided
      return res.json({
        success: true,
        source: "mock",
        questions: getMockQuestions(topic, category, quantity, type, difficulty, tags),
      });
    }

    const prompt = `Generate exactly ${quantity} exam questions about the topic "${topic || "Web Development"}".
Category: ${category || "General"}
Difficulty: ${difficulty}
Allowed Types: ${type === "all" ? "multiple-choice, true-false, short-answer, coding" : type}
Required Tags: ${tags.length > 0 ? tags.join(", ") : "none"}

Provide high quality questions appropriate for classroom examination.
For coding questions, ask a technical programming question, include expected input/output or code constraints, and specify the correct solution in "correctAnswer".
For multiple-choice questions, provide exactly 4 options.
For true-false, provide exactly 2 options: ["True", "False"].
Provide accurate correct answers and explanations for all questions.`;

    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: "You are an elite educational examiner specialized in designing technical high-fidelity examination questions. You always respond with a clean, validated JSON object that contains an array of questions conforming strictly to the requested schema. Do not output markdown backticks or any dialogue, only the exact JSON object.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              description: "Array of exam questions generated",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description: "One of: multiple-choice, true-false, short-answer, coding",
                  },
                  question: {
                    type: Type.STRING,
                    description: "The wording of the exam question.",
                  },
                  options: {
                    type: Type.ARRAY,
                    description: "List of choices if multiple-choice or true-false (e.g. ['True', 'False']), keep blank or null for other types.",
                    items: { type: Type.STRING }
                  },
                  correctAnswer: {
                    type: Type.STRING,
                    description: "The correct answer value. For MCQs, must exactly match one of the options. For true-false, 'True' or 'False'. For short-answer, key phrases. For coding, code script/answer key.",
                  },
                  explanation: {
                    type: Type.STRING,
                    description: "Detailed step-by-step educational explanation of why the answer is correct.",
                  },
                  difficulty: {
                    type: Type.STRING,
                    description: "One of: easy, medium, hard",
                  },
                  category: {
                    type: Type.STRING,
                    description: "The primary subject category of this question.",
                  },
                  tags: {
                    type: Type.ARRAY,
                    description: "Relevant keyword tags.",
                    items: { type: Type.STRING }
                  }
                },
                required: ["type", "question", "correctAnswer", "explanation", "difficulty", "category", "tags"]
              }
            }
          }
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response from Gemini API");
    }

    const data = JSON.parse(text);
    return res.json({
      success: true,
      source: "gemini",
      questions: data.questions || [],
    });

  } catch (error: any) {
    console.error("Gemini Question Generation Error:", error);
    // Fall back to high quality mock data rather than crashing
    return res.json({
      success: true,
      source: "fallback",
      error: error.message,
      questions: getMockQuestions(
        req.body.topic || "JavaScript",
        req.body.category || "Programming",
        req.body.quantity || 5,
        req.body.type || "all",
        req.body.difficulty || "medium",
        req.body.tags || []
      ),
    });
  }
});

// 2. Endpoint: Rubric-Based Essay / Short Answer Grading
app.post("/api/gemini/evaluate-essay", async (req, res) => {
  try {
    const { question, studentAnswer, rubric, maxPoints = 10 } = req.body;

    const client = getGenAI();
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
      // Mock evaluation response
      const points = Math.min(maxPoints, Math.floor(studentAnswer.length / 50) + 4);
      return res.json({
        success: true,
        source: "mock",
        score: points,
        maxPoints,
        comments: `Graded via simulation (API Key not provided).
- Answer is about ${studentAnswer.length} characters long.
- Contains relevant technical vocabulary.
- Clear formulation of ideas. Write more detail for higher grades.`,
        strengths: ["Shows basic understanding", "Addresses the primary prompt requirement"],
        weaknesses: ["Needs deeper analysis of the technical specifications", "Could include more direct proof/examples"],
        improvementPlan: "Study chapter guidelines and practice writing step-by-step structures detailing your architectures."
      });
    }

    const prompt = `Evaluate the following student's answer for the matching question.
Question/Prompt:
"${question}"

Student's Answer:
"${studentAnswer || "[No answer provided]"}"

Evaluation Criteria / Rubric:
"${rubric || "Correctness, detail, clarity, and specific terms definition"}"

Maximum Possible Points: ${maxPoints}

Generate a formal assessment score and diagnostic feedback.`;

    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: "You are an objective academic evaluator. Score the essay or response out of the maximum points provided using the rubric, and give rich, supportive, and analytical feedback. You must respond with a clean, valid JSON object.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: {
              type: Type.NUMBER,
              description: "The awarded points between 0 and maxPoints (rounded to nearest 0.5)"
            },
            comments: {
              type: Type.STRING,
              description: "Detailed, constructive educational explanation of the grade and compliance with the rubric."
            },
            strengths: {
              type: Type.ARRAY,
              description: "A list of bullet points detailing positive aspects of the student's answer.",
              items: { type: Type.STRING }
            },
            weaknesses: {
              type: Type.ARRAY,
              description: "A list of concrete points detailing missing content, mistakes, or gaps in logic.",
              items: { type: Type.STRING }
            },
            improvementPlan: {
              type: Type.STRING,
              description: "Tailored recommendation on exactly what resources, rules, or tactics to study next to improve this grade."
            }
          },
          required: ["score", "comments", "strengths", "weaknesses", "improvementPlan"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty evaluation response.");

    const data = JSON.parse(text);
    return res.json({
      success: true,
      source: "gemini",
      ...data
    });

  } catch (error: any) {
    console.error("Essay evaluation error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not evaluate essay response",
      error: error.message
    });
  }
});

// 3. Endpoint: Personalized Recommendations & Topic-Wise Analytics
app.post("/api/gemini/generate-recommendations", async (req, res) => {
  try {
    const { performanceHistory, recentExamDetails } = req.body;

    const client = getGenAI();
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
      return res.json({
        success: true,
        source: "mock",
        summary: "Based on overall records, you are performing at stable rate. Review your coding and short answer questions more deeply to convert theoretical definitions into active practical implementation.",
        recommendations: [
          "Practice coding assignments under simulated time limits.",
          "Strengthen core concepts in CSS Grid/Flexbox and DOM event listeners.",
          "Try setting up structural flow diagrams before answering multi-step scenario questions."
        ],
        suggestedCategories: ["Responsive Layouts", "Functional JS Programming"]
      });
    }

    const prompt = `Analyze this student's exam performance:
Recent Exam Stats:
- Title: ${recentExamDetails?.title || "Exam"}
- Total Score: ${recentExamDetails?.score}/${recentExamDetails?.maxPossibleScore}
- Ratio: ${recentExamDetails?.percentage}%
- Wrong Questions & Topics: ${JSON.stringify(recentExamDetails?.incorrectSummary || [])}

Performance History:
${JSON.stringify(performanceHistory || [])}

Generate a diagnostic summary, specific actionable recommendations, and list the key categories the student should prioritize.`;

    const response = await client.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: "You are an adaptive learning coach. Analyze students' errors and history, and provide motivational, direct, and actionable guidelines. You must respond with a clean, valid JSON object.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "A summary analysis (1-2 paragraphs) of performance trends, specific struggles, and progress indicators."
            },
            recommendations: {
              type: Type.ARRAY,
              description: "A list of discrete, actionable study actions they can take tomorrow to improve.",
              items: { type: Type.STRING }
            },
            suggestedCategories: {
              type: Type.ARRAY,
              description: "Subject areas or categories of topics to study next.",
              items: { type: Type.STRING }
            }
          },
          required: ["summary", "recommendations", "suggestedCategories"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Empty recommendations response.");

    const data = JSON.parse(text);
    return res.json({
      success: true,
      source: "gemini",
      ...data
    });

  } catch (error: any) {
    console.error("Recommendations generation error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not generate adaptive coaching insights",
      error: error.message
    });
  }
});

// Helper function to return beautiful, rich mock questions matching schemas when API is absent or offline
function getMockQuestions(topic: string, category: string, quantity: number, type: string, difficulty: string, reqTags: string[]) {
  const allMocks = [
    {
      type: "multiple-choice",
      question: "Which of the following is correct about features of JavaScript?",
      options: [
        "JavaScript is a lightweight, interpreted programming language.",
        "JavaScript is designed for creating network-centric applications.",
        "JavaScript is complementary to and integrated with Java.",
        "All of the above."
      ],
      correctAnswer: "All of the above.",
      explanation: "JavaScript is a lightweight, interpreted, client-side, cross-platform scripting language engineered for network-centric and rich user interface application logic.",
      difficulty: "easy",
      category: category || "JavaScript",
      tags: ["basics", "frameworks", "core-fundamentals"]
    },
    {
      type: "true-false",
      options: ["True", "False"],
      question: "In React, state changes dynamically invoke child renders unless guarded by React.memo or similar primitives.",
      correctAnswer: "True",
      explanation: "When a component's state changes, React trigger-renders the entire subtree of elements recursively, unless optimizations are placed to short-circuit state prop evaluation.",
      difficulty: "medium",
      category: category || "React",
      tags: ["state-management", "optimization"]
    },
    {
      type: "short-answer",
      question: "Explain what is a Promise in JavaScript and list its primary three possible states.",
      correctAnswer: "A Promise is an object representing the eventual completion or failure of an asynchronous operation. Its three states are Pending, Fulfilled, and Rejected.",
      explanation: "Promises resolve standard nested-callback hell by providing a flat structure with .then(), .catch() and .finally() methods mapping to their asynchronous states.",
      difficulty: "medium",
      category: category || "Asynchronous JS",
      tags: ["async", "promises", "interview"]
    },
    {
      type: "coding",
      question: "Write an efficient JavaScript function called 'findFactorial(n)' which recursively calculates and returns the factorial of a positive integer 'n'. Assume n is reliable and fits in standard Call Stack limits.",
      correctAnswer: "function findFactorial(n) {\n  if (n <= 1) return 1;\n  return n * findFactorial(n - 1);\n}",
      explanation: "Factorial is modeled as n! = n * (n-1)!. The recursive base case stops at 1 or 0 ensuring we do not overflow stack execution.",
      difficulty: "medium",
      category: category || "Programming Algorithms",
      tags: ["recursion", "math", "algorithms"]
    },
    {
      type: "multiple-choice",
      question: "What is the primary visual difference between flex-direction: 'column' and 'row' in CSS Flexbox?",
      options: [
        "Column aligns children vertically, while Row aligns children horizontally",
        "Row distributes components into multi-level grid lines",
        "Column increases the margin spacing between elements",
        "There is no difference"
      ],
      correctAnswer: "Column aligns children vertically, while Row aligns children horizontally",
      explanation: "The default main-axis in CSS Flexbox is row (left to right). Changing flex-direction to column shifts the primary main axis vertically (top to bottom).",
      difficulty: "easy",
      category: category || "CSS Layouts",
      tags: ["flexbox", "responsive-layout"]
    },
    {
      type: "coding",
      question: "Write a JavaScript function called 'isPalindrome(str)' that accepts a string, removes non-alphanumeric elements, and checks whether the cleaned sequence reads the same backwards.",
      correctAnswer: "function isPalindrome(str) {\n  const clean = str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();\n  return clean === clean.split('').reverse().join('');\n}",
      explanation: "Regex isolates letters and digits. Standard array conversion allows reversal comparison to determine symmetry.",
      difficulty: "hard",
      category: category || "String Processing",
      tags: ["regex", "string-manipulation"]
    }
  ];

  // Filter based on selected parameters
  let filtered = allMocks;
  if (type !== "all") {
    filtered = filtered.filter(q => q.type === type);
  }
  
  // If we don't have enough, we repeat or adjust
  let result = [];
  for (let i = 0; i < quantity; i++) {
    const item = filtered[i % filtered.length];
    // Clone and customize tags or topic if needed
    result.push({
      ...item,
      category: category || item.category,
      tags: reqTags.length > 0 ? [...new Set([...item.tags, ...reqTags])] : item.tags
    });
  }
  return result;
}

// Vite integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Online Examination System runs on http://localhost:${PORT}`);
  });
}

startServer();
