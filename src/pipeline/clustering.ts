import { CanonicalConversation, ProjectCluster } from "../core/types";

export class ProjectClusterer {
  /**
   * Clusters a set of canonical conversations into discrete, authentic software projects.
   * Multiple chats and sessions belonging to the same project or research workstream are unified.
   */
  public static cluster(conversations: CanonicalConversation[]): ProjectCluster[] {
    if (conversations.length === 0) return [];

    // Map of normalized project key -> array of conversations
    const projectGroups = new Map<string, { name: string; description: string; convos: CanonicalConversation[] }>();

    for (const convo of conversations) {
      const mapping = this.identifyProjectKey(convo);
      if (!projectGroups.has(mapping.key)) {
        projectGroups.set(mapping.key, { name: mapping.name, description: mapping.desc, convos: [] });
      }
      projectGroups.get(mapping.key)!.convos.push(convo);
    }

    // Convert groups into ProjectCluster records
    const projectClusters: ProjectCluster[] = [];

    for (const [key, group] of projectGroups.entries()) {
      const clusterConvos = group.convos;
      const combinedText = clusterConvos
        .flatMap(c => [c.title, ...c.messages.slice(0, 8).map(m => m.content)])
        .join(" ");

      const techStack = this.detectTechStack(combinedText);
      const decisions = this.extractDecisions(combinedText);
      const timestamps = clusterConvos.map(c => new Date(c.createdAt).getTime()).sort();

      const sampleTopics = clusterConvos
        .map(c => c.title.replace(/^[^:]+:\s*/, "").replace(/<[^>]+>/g, "").trim())
        .filter(t => t.length > 5)
        .slice(0, 4);

      projectClusters.push({
        id: `proj_${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        name: group.name,
        description: `${group.description} Consolidated across ${clusterConvos.length} session(s). Focus topics: ${sampleTopics.join("; ") || "Core engineering & implementation"}.`,
        confidence: Math.min(0.99, 0.75 + clusterConvos.length * 0.03),
        conversationIds: clusterConvos.map(c => c.id),
        primaryTechStack: techStack,
        keyDecisions: decisions,
        createdAt: new Date(timestamps[0]).toISOString(),
        updatedAt: new Date(timestamps[timestamps.length - 1]).toISOString()
      });
    }

    // Sort by conversation count (most active projects first)
    return projectClusters.sort((a, b) => b.conversationIds.length - a.conversationIds.length);
  }

  /**
   * Deterministically maps a conversation to its authentic project domain.
   */
  private static identifyProjectKey(convo: CanonicalConversation): { key: string; name: string; desc: string } {
    const meta = convo.metadata || {};
    const title = (convo.title || "").toLowerCase();
    const sourceId = (convo.sourceId || "").toLowerCase();
    const projectFolder = (meta.projectFolder || "").toLowerCase();
    
    // Check first few user messages
    const userTexts = convo.messages
      .filter(m => m.role === "user")
      .slice(0, 4)
      .map(m => m.content)
      .join(" ")
      .toLowerCase();

    const fullBlob = `${title} ${sourceId} ${projectFolder} ${JSON.stringify(meta).toLowerCase()} ${userTexts.substring(0, 1500)}`;

    // 1. Explicit Claude Code Project Folder Mappings
    if (projectFolder.includes("price-signal") || projectFolder.includes("ai-trading-bot")) {
      return {
        key: "financial_system",
        name: "Financial Data Analysis & Market Intelligence",
        desc: "Autonomous AI trading terminals (AegisQuant), microstructure price signal analysis, backtesting, and real-time market feeds."
      };
    }
    if (projectFolder.includes("vsa-ground") || projectFolder.includes("convolution-research")) {
      return {
        key: "phasor_research",
        name: "Phasor & Wave AI Neural Research",
        desc: "Complex-valued neural networks (CVNN), continuous Fourier VSA bank, phasor unitary operators, and ground wave rebuilds."
      };
    }
    if (projectFolder.includes("saptarshi") || projectFolder.includes("resonance")) {
      return {
        key: "resonance_architecture",
        name: "Resonance-X & Saptarshi Neural Architecture",
        desc: "Resonance syntax engine, holographic resonator core, coherent testing, and REXC neural processing units."
      };
    }
    if (projectFolder.includes("node-network")) {
      return {
        key: "node_network_distributed",
        name: "Node Network & Distributed Peer Infrastructure",
        desc: "Decentralized compute node network, peer-to-peer communications, distributed telemetry, and task scheduling."
      };
    }
    if (projectFolder.includes("agent-toolkit")) {
      return {
        key: "winterm_toolkit",
        name: "WinTerm Desktop Agent Automation Toolkit",
        desc: "Desktop OS automation, Win32 UI interaction engine, keyboard/mouse event hooks, and autonomous agent control."
      };
    }
    if (projectFolder.includes("prime-research")) {
      return {
        key: "prime_hunter",
        name: "Prime Number & Hyperspace Record Hunter",
        desc: "Arbitrary-digit BBP spigot formula extraction, high-dimensional prime sieves, and distributed record discovery."
      };
    }

    // 2. Security & Vulnerability Audits
    if (
      fullBlob.includes("vulnerabilities") || 
      fullBlob.includes("security review") || 
      fullBlob.includes("candidate vulnerabilities") ||
      fullBlob.includes("differential review") ||
      fullBlob.includes("cve")
    ) {
      return {
        key: "security_vulnerability_audit",
        name: "Autonomous Security Review & Vulnerability Audits",
        desc: "Automated differential code reviews, security vulnerability scanning, invariant checks, and exploit prevention."
      };
    }

    // 3. Autonomous Agent Swarms & DeepSeek
    if (
      fullBlob.includes("agent swarm") || 
      fullBlob.includes("deepseek") || 
      fullBlob.includes("swarm of deepseek")
    ) {
      return {
        key: "agent_swarm_deepseek",
        name: "Autonomous Agent Swarms & Large Model Orchestration",
        desc: "Multi-agent swarm coordination, DeepSeek-V4 local agent workflows, model unrolling, and autonomous collaborative execution."
      };
    }

    // 4. NSCK (Neuro-Symbolic Cognitive Kernel & Engine)
    if (
      fullBlob.includes("nsck") || 
      fullBlob.includes("neuro-symbolic") || 
      fullBlob.includes("cognitive_engine") ||
      fullBlob.includes("qfhrr") ||
      fullBlob.includes("action leakage") ||
      fullBlob.includes("action enforcement") ||
      fullBlob.includes("task control architecture")
    ) {
      return {
        key: "nsck_engine",
        name: "NSCK Neuro-Symbolic Cognitive Engine",
        desc: "Unified neuro-symbolic brain: cognitive action constraints, reasoning engine, task control, and neuro-symbolic kernels."
      };
    }

    // 5. Financial Trading & Market Analysis
    if (
      fullBlob.includes("financial") || 
      fullBlob.includes("price-signal") || 
      fullBlob.includes("price_signal") || 
      fullBlob.includes("trading") || 
      fullBlob.includes("orderbook") || 
      fullBlob.includes("trade strategy") ||
      fullBlob.includes("backtest") ||
      fullBlob.includes("ai-trader") ||
      fullBlob.includes("aegisquant")
    ) {
      return {
        key: "financial_system",
        name: "Financial Data Analysis & Market Intelligence",
        desc: "High-frequency price signal analysis, algorithmic backtesting repositories, market microstructure, and automated trading."
      };
    }

    // 6. Phasor & Vector Symbolic Architectures (VSA)
    if (
      fullBlob.includes("phasor") || 
      fullBlob.includes("wavelearn") || 
      fullBlob.includes("cvnn") || 
      fullBlob.includes("unitary") || 
      fullBlob.includes("vsa") || 
      fullBlob.includes("vssp") ||
      fullBlob.includes("spca") ||
      fullBlob.includes("fourier") || 
      fullBlob.includes("symbol encoding") ||
      fullBlob.includes("frequency/wave") ||
      fullBlob.includes("convolution")
    ) {
      return {
        key: "phasor_research",
        name: "Phasor & Wave AI Neural Research",
        desc: "Complex-valued neural networks (CVNN), phasor unitary networks, wave propagation transforms, and vector symbolic architectures."
      };
    }

    // 7. Resonance-X & Saptarshi Neural Architecture
    if (
      fullBlob.includes("resonance") || 
      fullBlob.includes("saptarshi") || 
      fullBlob.includes("rexc") || 
      fullBlob.includes("resonator") ||
      fullBlob.includes("neuron v2") ||
      fullBlob.includes("digital neuron") ||
      fullBlob.includes("ai_research")
    ) {
      return {
        key: "resonance_architecture",
        name: "Resonance-X & Saptarshi Neural Architecture",
        desc: "Resonance syntax engine, digital neuron core, holographic resonator systems, and REXC neural processing units."
      };
    }

    // 8. Sophia Cognitive Architecture & Knowledge System
    if (
      fullBlob.includes("sophia") || 
      fullBlob.includes("concerto") || 
      fullBlob.includes("triple_store") || 
      fullBlob.includes("single_step_predictor")
    ) {
      return {
        key: "sophia_cognitive",
        name: "Sophia Cognitive Architecture & Knowledge System",
        desc: "Symbolic triple store, single-step prediction, concerto lifelong learning, and progressive knowledge graphs."
      };
    }

    // 9. Universal Cross-AI Memory System
    if (
      fullBlob.includes("universal-ai-memory") || 
      fullBlob.includes("memory_graph") || 
      fullBlob.includes("cross-ai memory") || 
      fullBlob.includes("cross-agent memory") || 
      fullBlob.includes("connects their claude or gemini") ||
      fullBlob.includes("mcp_server")
    ) {
      return {
        key: "universal_memory",
        name: "Universal Cross-AI Memory System",
        desc: "Zero-knowledge cross-IDE persistent memory graph, MCP intelligence serving, and cross-session learning."
      };
    }

    // 10. OmniPDF Document Studio
    if (fullBlob.includes("omnipdf") || fullBlob.includes("pdf-studio") || fullBlob.includes("pdf manager")) {
      return {
        key: "omnipdf_studio",
        name: "OmniPDF Document Studio",
        desc: "Secure local-first PDF viewer, document analysis, OCR extraction, and page manipulation suite."
      };
    }

    // 11. Deep Learning Workstation & GPU Infrastructure
    if (
      fullBlob.includes("rtx 3060") ||
      fullBlob.includes("rtx 3080") ||
      fullBlob.includes("3060 12") ||
      fullBlob.includes("3080 with 3060") ||
      fullBlob.includes("gpu advice") ||
      fullBlob.includes("gaming pc") ||
      fullBlob.includes("selling gaming") ||
      fullBlob.includes("dual-gpu") ||
      fullBlob.includes("vram") ||
      fullBlob.includes("international move") ||
      fullBlob.includes("workstation")
    ) {
      return {
        key: "gpu_workstation_infra",
        name: "Deep Learning Workstation & GPU Infrastructure",
        desc: "Multi-GPU hardware architecture (RTX 3060 12GB / RTX 3080), local AI model inference workloads, thermal and PCIe sizing, and hardware lifecycle."
      };
    }

    // 12. Wearable AI & Smart Optics Systems
    if (
      fullBlob.includes("ray-ban") ||
      fullBlob.includes("smart glasses") ||
      fullBlob.includes("scribers") ||
      fullBlob.includes("wearable")
    ) {
      return {
        key: "wearable_smart_optics",
        name: "Wearable AI & Smart Optics Systems",
        desc: "Next-gen smart eyewear (Meta Ray-Ban / Scribers Gen 2), spatial hardware evaluation, edge audio/vision capture, and wearable agent interfaces."
      };
    }

    // 13. High-Performance Low-Level Neural Systems (Rust & C)
    if (
      fullBlob.includes("neural networks library in rust") ||
      fullBlob.includes("neural network in rust") ||
      fullBlob.includes("neural network implementation in c") ||
      fullBlob.includes("neural network in c") ||
      fullBlob.includes("matrix multiplication in c") ||
      fullBlob.includes("cache optimization with neural")
    ) {
      return {
        key: "lowlevel_neural_engines",
        name: "High-Performance Low-Level Neural Systems (Rust & C)",
        desc: "Zero-dependency neural network implementations in Rust and C, memory-safe tensor operations, SIMD vectorization, and bare-metal compute kernels."
      };
    }

    // 14. Continual Learning & Advanced Foundation Architectures
    if (
      fullBlob.includes("catastrophic forgetting") ||
      fullBlob.includes("spacetime waves") ||
      fullBlob.includes("variable-length bit") ||
      fullBlob.includes("continual learning") ||
      fullBlob.includes("lifelong learning") ||
      fullBlob.includes("task-specific learning")
    ) {
      return {
        key: "continual_learning_foundations",
        name: "Continual Learning & Advanced Foundation Architectures",
        desc: "Lifelong weight consolidation without catastrophic forgetting, variable-length bit sequence transformers, and dynamic neural memory preservation."
      };
    }

    // 15. WinTerm Desktop Agent Automation Toolkit
    if (
      fullBlob.includes("winterm") || 
      fullBlob.includes("agent_toolkit") || 
      fullBlob.includes("desktop_gui") || 
      fullBlob.includes("window_manager") ||
      fullBlob.includes("click_ui") ||
      fullBlob.includes("windows shell reliability")
    ) {
      return {
        key: "winterm_toolkit",
        name: "WinTerm Desktop Agent Automation Toolkit",
        desc: "Operating system automation, GUI window management, keyboard/mouse interaction engine, and desktop app learning."
      };
    }

    // 16. Prime Number & Hyperspace Record Hunter
    if (
      fullBlob.includes("prime") || 
      fullBlob.includes("hyperspace") || 
      fullBlob.includes("digit of the pi") ||
      fullBlob.includes("digit of pi") ||
      fullBlob.includes("discovered_primes")
    ) {
      return {
        key: "prime_hunter",
        name: "Prime Number & Hyperspace Record Hunter",
        desc: "Large prime discovery algorithms, arbitrary-digit Pi calculations, number theoretical hyperspace search, and distributed prime hunters."
      };
    }

    // 17. x86_64 Low-Level Systems & Assembly Toolkit
    if (fullBlob.includes("assembly") || fullBlob.includes("x86_64") || fullBlob.includes("nasm")) {
      return {
        key: "assembly_toolkit",
        name: "x86_64 Low-Level Systems & Assembly Toolkit",
        desc: "High-performance x86_64 assembly routines, NASM build pipelines, and low-level system kernels."
      };
    }

    // 18. TireTrack System & Mobile Architecture
    if (
      fullBlob.includes("tiretrack") || 
      fullBlob.includes("tire app") || 
      fullBlob.includes("mini pc for tire") ||
      fullBlob.includes("emulator") || 
      fullBlob.includes("android")
    ) {
      return {
        key: "tiretrack_system",
        name: "TireTrack System & Mobile Architecture",
        desc: "Android emulator deployment, mobile system telemetry, device diagnostics, and mobile UI verification."
      };
    }

    // 19. Legal, Immigration & Administrative Advisory
    if (
      fullBlob.includes("visa") || 
      fullBlob.includes("passport") || 
      fullBlob.includes("immigration") || 
      fullBlob.includes("trafficking") ||
      fullBlob.includes("charges") ||
      fullBlob.includes("contract")
    ) {
      return {
        key: "legal_administrative_advisory",
        name: "Legal, Immigration & Administrative Advisory",
        desc: "Visa applications, passport name alignment, legal risk assessments, immigration procedures, and regulatory requirements."
      };
    }

    // 20. Personal Health & Wellness
    if (
      fullBlob.includes("throat") || 
      fullBlob.includes("mucus") || 
      fullBlob.includes("recipe") || 
      fullBlob.includes("paneer") ||
      fullBlob.includes("wellness")
    ) {
      return {
        key: "health_wellness_advisory",
        name: "Health, Nutrition & Wellness Consultation",
        desc: "Personal health inquiries, symptom management, dietary nutrition, and lifestyle wellness."
      };
    }

    // 21. Web & Fullstack Development
    if (
      fullBlob.includes("react") || 
      fullBlob.includes("next.js") || 
      fullBlob.includes("tailwind") || 
      fullBlob.includes("css") || 
      fullBlob.includes("html") || 
      fullBlob.includes("frontend")
    ) {
      return {
        key: "fullstack_web",
        name: "Modern Fullstack Web & UI Engineering",
        desc: "Interactive UI/UX engineering, Next.js, Tailwind CSS, TypeScript, and responsive web applications."
      };
    }

    // 22. General AI & Systems Engineering Labs (Fallback)
    return {
      key: "core_engineering_labs",
      name: "General AI & Systems Engineering Labs",
      desc: "Cross-cutting algorithmic experiments, devops automation, tooling, and exploratory engineering sessions."
    };
  }

  public static detectTechStack(text: string): string[] {
    const KNOWN_STACKS = [
      "TypeScript", "JavaScript", "Python", "Rust", "Go", "Java", "C++", "Assembly",
      "React", "Next.js", "Vue", "Svelte", "Hono", "Express", "FastAPI",
      "Tailwind CSS", "PostgreSQL", "SQLite", "MongoDB", "Redis", "Docker",
      "Prisma", "Drizzle", "GraphQL", "Zod", "Kubernetes", "PyTorch", "Pandas", "NumPy", "CUDA"
    ];

    const detected: string[] = [];
    const lower = text.toLowerCase();

    for (const tech of KNOWN_STACKS) {
      const escaped = tech.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`(?:\\b|(?<=[^a-z0-9]))${escaped}(?:\\b|(?=[^a-z0-9]))`, "i");
      if (pattern.test(lower)) {
        detected.push(tech);
      }
    }

    return Array.from(new Set(detected));
  }

  private static extractDecisions(text: string): string[] {
    const decisions: string[] = [];
    const DECISION_PATTERNS = [
      /(?:we decided to|chose to|prefer to|migrated to|switched to|standardized on|selected|adopted|recommend using|best approach is to|opted for)\s+([^.\n]{10,90})/gi,
      /(?:decision:|solution:|approach:)\s+([^.\n]{10,90})/gi
    ];

    for (const regex of DECISION_PATTERNS) {
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (decisions.length < 8) {
          const cleaned = match[1].trim().replace(/^["'`]|["'`]$/g, "");
          if (cleaned.length >= 10 && !decisions.includes(cleaned)) {
            decisions.push(cleaned);
          }
        }
      }
    }
    return decisions;
  }
}
