/**
 * =============================================================================
 * HERMES - Work item type labels
 * =============================================================================
 * Tasks, Issues and Suggestions share one UI; this maps a task_type to the
 * nouns used in labels, tooltips, empty states and activity copy so every
 * surface reads correctly for the active kind.
 * =============================================================================
 */

export const WORK_ITEM_TYPES = {
    task: {
        singular: 'Task',
        plural: 'Tasks',
        lower: 'task',
        lowerPlural: 'tasks',
    },
    issue: {
        singular: 'Issue',
        plural: 'Issues',
        lower: 'issue',
        lowerPlural: 'issues',
    },
    suggestion: {
        singular: 'Suggestion',
        plural: 'Suggestions',
        lower: 'suggestion',
        lowerPlural: 'suggestions',
    },
}

export function typeMeta(type) {
    return WORK_ITEM_TYPES[type] || WORK_ITEM_TYPES.task
}

export default typeMeta
