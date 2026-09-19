export const MOCK_CHATGPT_EXPORT = [
  {
    "id": "convo_chatgpt_001",
    "title": "Fullstack Next.js and Tailwind Setup",
    "create_time": 1715000000,
    "update_time": 1715003600,
    "mapping": {
      "node_1": {
        "id": "node_1",
        "parent": null,
        "children": ["node_2"],
        "message": {
          "id": "msg_1",
          "author": { "role": "user" },
          "create_time": 1715000000,
          "content": {
            "content_type": "text",
            "parts": [
              "I am building an SaaS app called ShopPulse. We are using Next.js, TypeScript, Tailwind CSS, and PostgreSQL. Connect with postgres://admin:superSecret123@db.internal:5432/shoppulse. Here is my secret key sk-abcdef12345678901234567890abcdef12. How do I configure auth?"
            ]
          }
        }
      },
      "node_2": {
        "id": "node_2",
        "parent": "node_1",
        "children": ["node_3"],
        "message": {
          "id": "msg_2",
          "author": { "role": "assistant" },
          "create_time": 1715000050,
          "content": {
            "content_type": "text",
            "parts": [
              "Here is how to configure auth using Lucia or NextAuth in TypeScript:\n```typescript\nimport { NextAuth } from 'next-auth';\nexport const authOptions = { providers: [] };\n```"
            ]
          }
        }
      },
      "node_3": {
        "id": "node_3",
        "parent": "node_2",
        "children": [],
        "message": {
          "id": "msg_3",
          "author": { "role": "user" },
          "create_time": 1715000100,
          "content": {
            "content_type": "text",
            "parts": [
              "We decided to avoid Prisma because of cold start latency on serverless edge. We switched away from Prisma to Drizzle ORM. Also I prefer strict TypeScript with zero any."
            ]
          }
        }
      }
    }
  },
  {
    "id": "convo_chatgpt_002_ephemeral",
    "title": "Translate to French",
    "create_time": 1716000000,
    "update_time": 1716000010,
    "mapping": {
      "node_e1": {
        "id": "node_e1",
        "parent": null,
        "children": ["node_e2"],
        "message": {
          "id": "msg_e1",
          "author": { "role": "user" },
          "create_time": 1716000000,
          "content": { "content_type": "text", "parts": ["translate to French: 'good morning friend'"] }
        }
      },
      "node_e2": {
        "id": "node_e2",
        "parent": "node_e1",
        "children": [],
        "message": {
          "id": "msg_e2",
          "author": { "role": "assistant" },
          "create_time": 1716000005,
          "content": { "content_type": "text", "parts": ["Bonjour mon ami"] }
        }
      }
    }
  }
];

export const MOCK_CLAUDE_EXPORT = [
  {
    "uuid": "claude_session_99",
    "name": "Rust High Performance Engine",
    "created_at": "2024-06-01T10:00:00Z",
    "updated_at": "2024-06-01T10:45:00Z",
    "chat_messages": [
      {
        "uuid": "cl_msg_1",
        "sender": "human",
        "created_at": "2024-06-01T10:00:00Z",
        "text": "Let's build a fast event streaming service in Rust with Tokio and Docker. We want to avoid Redis due to memory bloat and standardize on SQLite in WAL mode."
      },
      {
        "uuid": "cl_msg_2",
        "sender": "assistant",
        "created_at": "2024-06-01T10:01:00Z",
        "text": "Great choice. Here is the Tokio async loop:\n```rust\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n    println!(\"Running\");\n    Ok(())\n}\n```"
      }
    ]
  }
];

export const MOCK_GEMINI_EXPORT = [
  {
    "id": "gemini_session_42",
    "title": "Python Machine Learning Training",
    "createdAt": "2024-07-01T15:00:00Z",
    "turns": [
      {
        "query": "How do I optimize PyTorch distributed training with Docker and Python?",
        "response": "Use torch.distributed with NCCL backend:\n```python\nimport torch\nimport torch.distributed as dist\n```",
        "timestamp": "2024-07-01T15:00:00Z"
      }
    ]
  }
];
