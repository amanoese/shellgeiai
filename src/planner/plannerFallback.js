export function getFallbackReason(plan, error) {
  if (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (!plan || !Array.isArray(plan.variants) || plan.variants.length === 0) {
    return "Planner returned no variants.";
  }

  if (!Array.isArray(plan.workerTasks) || plan.workerTasks.length === 0) {
    return "Planner returned no worker tasks.";
  }

  if (plan.workerTasks.some((task) => !task.assignedVariant?.variantId)) {
    return "Planner returned worker tasks without assigned variants.";
  }

  return null;
}
