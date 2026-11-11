export const workStatuses = {
  idea: '아이디어', review: '검토 중', planning: '계획 수립',
  development: '개발 중', done: '완료', hold: '보류',
}
export const workRatings = [5, 4, 3, 2, 1, 0]
export const fieldKey = value => value.trim().replace(/[A-Z]/g, letter => letter.toLowerCase())
export const workRating = item => item.priority_rating ?? ({ high: 5, normal: 3, low: 1 }[item.priority] ?? 3)
export const ratingLabel = rating => rating === 0 ? 'X' : '★'.repeat(rating)

const workFields = {
  title: '', problem: '', status: 'idea', expected_result: '',
  references_text: '', constraints_text: '', acceptance_criteria: '', development_plan: '', next_step: '',
}

export function workDraft(item = {}) {
  return {
    ...Object.fromEntries(Object.entries(workFields).map(([key, fallback]) => [key, item[key] ?? fallback])),
    priority_rating: workRating(item),
    fields: [...(item.fields ?? [])],
  }
}

export function workPrompt(item) {
  const sections = [
    ['아이디어', item.title], ['분야', item.fields?.join(', ')], ['해결하려는 문제', item.problem],
    ['기대 결과', item.expected_result], ['참고 자료', item.references_text],
    ['제약 조건', item.constraints_text], ['완료 기준', item.acceptance_criteria],
    ['기존 개발 계획', item.development_plan], ['다음 조치', item.next_step],
  ]
  return [
    '아래 아이디어를 바탕으로 실행 가능한 개발 계획을 작성해 줘.',
    '목표, 구현 범위, 단계별 작업과 선후행 관계, 검증 기준, 위험, 착수 전 확인 질문을 정리해 줘.',
    '제공하지 않은 일정, 비용, 권한은 확정하지 말고 확인이 필요한 항목으로 표시해 줘.',
    ...sections.filter(([, value]) => value?.trim()).map(([label, value]) => label + '\n' + value.trim()),
  ].join('\n\n')
}

export function matchesWork(item, query, status, priority) {
  const text = query.trim().toLowerCase()
  return (!status || item.status === status) && (priority === '' || workRating(item) === priority)
    && (!text || [...Object.keys(workFields).filter(key => key !== 'status').map(key => item[key]), ...(item.fields ?? [])]
      .some(value => value?.toLowerCase().includes(text)))
}
