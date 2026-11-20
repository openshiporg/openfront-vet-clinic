/**
 * Get List Counts - dashboard server action to fetch item counts for all lists
 * Matches Dashboard1 implementation but uses dashboard's keystoneClient
 */

'use server'

import { PUBLIC_REQUEST_ERROR, safeErrorSummary } from '@/features/dashboard/lib/security';
import { keystoneClient } from '../lib/keystoneClient'
import { API_MAX_ROOT_FIELDS } from '@/features/keystone/security/breadthLimit'

export async function getListCounts(
  lists: Array<{
    key: string;
    isSingleton?: boolean;
    graphql?: {
      names: {
        listQueryName?: string;
        listQueryCountName?: string;
      };
    };
  }>
) {
  try {
    const listsToCount = lists.filter((list) => !list.isSingleton)
    const singletonLists = lists.filter((list) => list.isSingleton)

    const countQueries = listsToCount.flatMap((list) => {
      const countName = list.graphql?.names?.listQueryCountName
      return countName ? [`${list.key}: ${countName}`] : []
    })

    const singletonQueries = singletonLists.flatMap((list) => {
      const listQueryName = list.graphql?.names?.listQueryName
      return listQueryName ? [`singleton_${list.key}: ${listQueryName}(take: 1) { id }`] : []
    })

    const selections = [...countQueries, ...singletonQueries]
    if (selections.length === 0) return { success: true, data: {} }

    // The API runs at most API_MAX_ROOT_FIELDS (20) top-level fields per request, so ask in batches of 20.
    // A batch that fails leaves only its own cards without a count.
    const batches: string[][] = []
    for (let i = 0; i < selections.length; i += API_MAX_ROOT_FIELDS) batches.push(selections.slice(i, i + API_MAX_ROOT_FIELDS))
    const responses = await Promise.all(
      batches.map((batch) =>
        keystoneClient(`query GetListCounts { ${batch.join('\n')} }`, {}, {
          next: {
            revalidate: 60, // Cache for 1 minute since counts change frequently
            tags: ['list-counts'],
          },
        })
      )
    )
    const data: Record<string, unknown> = {}
    for (const response of responses) if (response.success && response.data) Object.assign(data, response.data)
    if (responses.every((response) => !response.success)) return responses[0]
    return { success: true, data }
  } catch (error: unknown) {
    console.error('Error fetching list counts:', safeErrorSummary(error))
    const errorMessage =
      PUBLIC_REQUEST_ERROR
    return { success: false, error: errorMessage }
  }
}