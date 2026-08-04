/**
 * =============================================================================
 * HERMES - Assignee gorunur adi (SAF)
 * =============================================================================
 * Ad cozulemediginde (yetki yok / dizin yuklenmedi) ham kimlik EKRANA
 * BASILMAZ — notr bir yer tutucu doner. Badge ve roster bu tek kaynagi
 * kullanir (§13: badge/tooltip uzerinden kimlik sizintisi olmamali).
 * =============================================================================
 */
export const UNKNOWN_ASSIGNEE_LABEL = 'Unknown user'

export const assigneeLabelOf = (assignment) =>
    assignment?.assigneeName || UNKNOWN_ASSIGNEE_LABEL
