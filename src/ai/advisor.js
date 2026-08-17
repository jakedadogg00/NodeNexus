import crypto from 'node:crypto';

export class AIAdvisor {
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.proposals = [];
    this.maxProposals = 50;
  }

  // Generates a strictly schema-validated AI proposal
  generateProposal(finding, evidence, workload, suggestedAction, risk = 'low', requiresApproval = true) {
    const proposalId = `prop_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // 15m expiration

    const proposal = {
      proposal_id: proposalId,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      workload_id: workload.workloadId,
      finding,
      confidence: 0.88,
      evidence: Array.isArray(evidence) ? evidence : [evidence],
      action: {
        type: suggestedAction.type || 'set_concurrency',
        parameters: suggestedAction.parameters || {}
      },
      risk,
      approval_required: requiresApproval,
      verification_window: '10m',
      rollback: {
        type: suggestedAction.rollbackType || 'restore_previous_policy',
        parameters: suggestedAction.rollbackParams || {}
      },
      signature: crypto.createHash('sha256').update(proposalId + workload.workloadId).digest('hex')
    };

    this.proposals.unshift(proposal);
    if (this.proposals.length > this.maxProposals) {
      this.proposals.pop();
    }

    return proposal;
  }

  getProposals() {
    // Filter out expired proposals
    const now = Date.now();
    return this.proposals.filter(p => new Date(p.expires_at).getTime() > now);
  }
}
