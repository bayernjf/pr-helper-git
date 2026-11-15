// Four-role team matrix (P2-8): the same policy the engine enforces server-side,
// exposed to the client so disabled actions explain themselves before a round
// trip. Production merge and rollback narrow to Owner.
export type TeamRole = 'owner' | 'editor' | 'operator' | 'viewer';
export type TeamOperation =
  | 'workflow-view'
  | 'workflow-edit'
  | 'workflow-delete'
  | 'pr-create'
  | 'actions-rerun'
  | 'pull-merge'
  | 'deployment-rollback'
  | 'team-manage';

const ROLE_OPERATIONS: Record<TeamRole, readonly TeamOperation[]> = {
  owner: ['workflow-view', 'workflow-edit', 'workflow-delete', 'pr-create', 'actions-rerun', 'pull-merge', 'deployment-rollback', 'team-manage'],
  editor: ['workflow-view', 'workflow-edit', 'pr-create', 'actions-rerun'],
  operator: ['workflow-view', 'pr-create', 'actions-rerun'],
  viewer: ['workflow-view'],
};

const OPERATION_LABEL: Record<TeamOperation, string> = {
  'workflow-view': '查看流程',
  'workflow-edit': '编辑流程',
  'workflow-delete': '删除流程',
  'pr-create': '创建 PR',
  'actions-rerun': '重跑 Actions',
  'pull-merge': '合并 PR',
  'deployment-rollback': '部署回滚',
  'team-manage': '管理团队',
};

export function canPerformTeamOperation(
  role: TeamRole | null | undefined,
  operation: TeamOperation,
  environment: 'preview' | 'production' = 'preview',
) {
  if (!role || !ROLE_OPERATIONS[role].includes(operation)) return false;
  if (environment === 'production' && (operation === 'pull-merge' || operation === 'deployment-rollback')) {
    return role === 'owner';
  }
  return true;
}

export function teamRoleLabel(role: TeamRole) {
  return ({ owner: 'Owner', editor: 'Editor', operator: 'Operator', viewer: 'Viewer' })[role];
}

export function assertTeamOperation(
  role: TeamRole | null | undefined,
  operation: TeamOperation,
  environment: 'preview' | 'production' = 'preview',
) {
  if (canPerformTeamOperation(role, operation, environment)) return;
  if (!role) throw new Error('未获得共享流程访问权限');
  throw new Error(`团队角色 ${teamRoleLabel(role)} 无权执行${OPERATION_LABEL[operation]}`);
}
