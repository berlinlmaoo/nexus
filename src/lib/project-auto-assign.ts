interface AutoAssignConfigInput {
  autoAssignEnabled?: boolean | null
  autoAssignAssigneeIds?: string[] | null
}

interface NormalizeAutoAssignConfigOptions {
  memberIds: string[]
  requireAssigneesWhenEnabled?: boolean
}

interface NormalizedAutoAssignConfig {
  autoAssignEnabled: boolean
  autoAssignAssigneeIds: string[]
}

export class ProjectAutoAssignConfigError extends Error {}

export function normalizeAutoAssignConfig(
  input: AutoAssignConfigInput,
  options: NormalizeAutoAssignConfigOptions
): NormalizedAutoAssignConfig {
  const uniqueMemberIds = new Set(options.memberIds)
  const nextAssigneeIds = Array.from(
    new Set((input.autoAssignAssigneeIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))
  ).filter((id) => uniqueMemberIds.has(id))

  const nextEnabled = Boolean(input.autoAssignEnabled)

  if (nextEnabled && options.requireAssigneesWhenEnabled !== false && nextAssigneeIds.length === 0) {
    throw new ProjectAutoAssignConfigError("Select at least one project member to enable auto assign")
  }

  return {
    autoAssignEnabled: nextEnabled,
    autoAssignAssigneeIds: nextAssigneeIds,
  }
}

export function resolveAutoAssignAssigneeIds(options: {
  requestedAssigneeIds?: string[] | null
  autoAssignEnabled: boolean
  autoAssignAssigneeIds: string[]
  validProjectMemberIds: string[]
}): string[] {
  const requestedAssigneeIds = Array.from(
    new Set((options.requestedAssigneeIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))
  )

  if (requestedAssigneeIds.length > 0) {
    return requestedAssigneeIds
  }

  if (!options.autoAssignEnabled) {
    return []
  }

  const validMemberIds = new Set(options.validProjectMemberIds)

  return Array.from(
    new Set(options.autoAssignAssigneeIds.filter((id) => validMemberIds.has(id)))
  )
}
