import { GraphStore } from "../storage/graph_store";

export class HiveBrain {
  /**
   * Autonomous audit cycle: finds real cross-project contradictions in the
   * knowledge graph — specifically, a technology one project explicitly
   * rejected that another project is actively using — and files a Hive
   * inquiry for each one not already on record.
   */
  public static auditAndSynthesize(store: GraphStore): { detectedDiscrepancies: number; newInquiries: number } {
    const projects = store.listProjects();
    const graph = store.getFullGraph();
    const existingInquiries = store.listInquiries();

    const projectById = new Map(projects.map(p => [`node_proj_${p.id}`, p]));
    const nodeNameById = new Map(graph.nodes.map(n => [n.id, n.name] as const));
    const nodeById = new Map(graph.nodes.map(n => [n.id, n] as const));

    // techName (lowercase) -> set of project node ids that actively USE it
    const usersOfTech = new Map<string, Set<string>>();
    // techName (lowercase) -> map of rejecting project node id -> reason
    const rejectersOfTech = new Map<string, Map<string, string>>();

    for (const edge of graph.edges) {
      if (edge.status !== "active" || !projectById.has(edge.sourceNodeId)) continue;

      if (edge.relation === "USES_TECH") {
        const techName = (nodeNameById.get(edge.targetNodeId) || "").toLowerCase().trim();
        if (!techName) continue;
        if (!usersOfTech.has(techName)) usersOfTech.set(techName, new Set());
        usersOfTech.get(techName)!.add(edge.sourceNodeId);
      }

      if (edge.relation === "REJECTED") {
        const targetNode = nodeById.get(edge.targetNodeId);
        if (!targetNode) continue;
        // NegativeKnowledge node names are always "Avoid <subject>" (see extractor.ts / llm_extractor.ts)
        const rejectedName = targetNode.name.replace(/^Avoid\s+/i, "").toLowerCase().trim();
        if (!rejectedName) continue;
        if (!rejectersOfTech.has(rejectedName)) rejectersOfTech.set(rejectedName, new Map());
        rejectersOfTech.get(rejectedName)!.set(edge.sourceNodeId, edge.context || targetNode.summary || "no reason recorded");
      }
    }

    let checksRun = 0;
    let newInquiriesCount = 0;

    for (const [techName, rejecterMap] of rejectersOfTech.entries()) {
      const userProjectIds = usersOfTech.get(techName);
      if (!userProjectIds || userProjectIds.size === 0) continue;

      for (const [rejecterId, reason] of rejecterMap.entries()) {
        for (const userId of userProjectIds) {
          checksRun++;
          if (rejecterId === userId) continue; // same project rejecting+using isn't a cross-project contradiction

          const rejecterProj = projectById.get(rejecterId);
          const userProj = projectById.get(userId);
          if (!rejecterProj || !userProj) continue;

          const inquiryId = `inq_contradiction_${techName.replace(/[^a-z0-9]/g, "_")}_${rejecterProj.id}_${userProj.id}`;
          if (existingInquiries.some(e => e.id === inquiryId)) continue;

          store.createInquiry({
            id: inquiryId,
            projectId: userProj.id,
            projectName: userProj.name,
            category: "architecture_conflict",
            question: `"${userProj.name}" actively uses ${techName}, but "${rejecterProj.name}" explicitly rejected it. Is that still the right call for "${userProj.name}"?`,
            options: [
              { id: "opt_keep", label: `Keep ${techName} in ${userProj.name}`, details: "The rejection recorded in the other project doesn't apply here." },
              { id: "opt_reconsider", label: `Reconsider ${techName} in ${userProj.name}`, details: `Reason it was rejected elsewhere: ${reason}` }
            ],
            context: `${rejecterProj.name} rejected ${techName} (${reason}). ${userProj.name} currently uses it.`
          });
          newInquiriesCount++;
        }
      }
    }

    return { detectedDiscrepancies: checksRun, newInquiries: newInquiriesCount };
  }
}
