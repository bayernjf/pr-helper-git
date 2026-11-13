const roleOperations = {
  owner: ["workflow-view", "workflow-edit", "workflow-delete", "pr-create", "actions-rerun", "pull-merge", "deployment-rollback", "team-manage"],
  editor: ["workflow-view", "workflow-edit", "pr-create", "actions-rerun"],
  operator: ["workflow-view", "pr-create", "actions-rerun"],
  viewer: ["workflow-view"]
};
function canPerformTeamOperation(role, operation, environment = "preview") {
  if (!role || !roleOperations[role].includes(operation)) return false;
  if (environment === "production" && (operation === "pull-merge" || operation === "deployment-rollback")) return role === "owner";
  return true;
}
function teamRoleLabel(role) {
  return { owner: "Owner", editor: "Editor", operator: "Operator", viewer: "Viewer" }[role];
}
const operationLabel = {
  "workflow-view": "\u67E5\u770B\u6D41\u7A0B",
  "workflow-edit": "\u7F16\u8F91\u6D41\u7A0B",
  "workflow-delete": "\u5220\u9664\u6D41\u7A0B",
  "pr-create": "\u521B\u5EFA PR",
  "actions-rerun": "\u91CD\u8DD1 Actions",
  "pull-merge": "\u5408\u5E76 PR",
  "deployment-rollback": "\u90E8\u7F72\u56DE\u6EDA",
  "team-manage": "\u7BA1\u7406\u56E2\u961F"
};
function assertTeamOperation(role, operation, environment = "preview") {
  if (canPerformTeamOperation(role, operation, environment)) return;
  if (!role) throw new Error("\u672A\u83B7\u5F97\u5171\u4EAB\u6D41\u7A0B\u8BBF\u95EE\u6743\u9650");
  throw new Error(`\u56E2\u961F\u89D2\u8272 ${teamRoleLabel(role)} \u65E0\u6743\u6267\u884C${operationLabel[operation]}`);
}
export {
  assertTeamOperation,
  canPerformTeamOperation,
  teamRoleLabel
};
