/** The sidebar card is for an empty practice: hidden once setup is finished/dismissed or the practice has a team. */
export function shouldShowOnboardingCard(input: {
  canManageOnboarding?: boolean | null
  onboardingStatus?: string | null
  menuItemsCount?: number | null
}): boolean {
  if (!input.canManageOnboarding) return false
  if (input.onboardingStatus === "completed" || input.onboardingStatus === "dismissed") return false
  if (typeof input.menuItemsCount === "number" && input.menuItemsCount > 0) return false
  return true
}
