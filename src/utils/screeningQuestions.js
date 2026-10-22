const { randomUUID } = require('crypto');

const TYPES = new Set(['YES_NO', 'CHECKBOX', 'SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'SINGLE_CHOICE', 'MULTI_CHOICE']);

const parseJson = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
};

const normalizeQuestions = (input) => {
  const raw = parseJson(input, []);
  if (!Array.isArray(raw)) throw Object.assign(new Error('Application questions must be a list.'), { statusCode: 400 });
  if (raw.length > 20) throw Object.assign(new Error('A job can have no more than 20 application questions.'), { statusCode: 400 });
  return raw.map((item, index) => {
    const prompt = String(item?.prompt || item?.question || '').trim();
    const type = String(item?.type || '').toUpperCase();
    if (!prompt) throw Object.assign(new Error(`Question ${index + 1} is empty.`), { statusCode: 400 });
    if (prompt.length > 500) throw Object.assign(new Error(`Question ${index + 1} is too long.`), { statusCode: 400 });
    if (!TYPES.has(type)) throw Object.assign(new Error(`Question ${index + 1} has an invalid answer type.`), { statusCode: 400 });
    const options = ['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type)
      ? [...new Set((Array.isArray(item.options) ? item.options : []).map((option) => String(option).trim()).filter(Boolean))].slice(0, 20)
      : [];
    if (['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type) && options.length < 2) {
      throw Object.assign(new Error(`Question ${index + 1} needs at least two choices.`), { statusCode: 400 });
    }
    return { id: String(item?.id || randomUUID()), prompt, type, required: Boolean(item?.required), options };
  });
};

const validateAnswers = (questionsInput, answersInput) => {
  const questions = normalizeQuestions(questionsInput || []);
  const rawAnswers = parseJson(answersInput, {});
  const answerMap = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers) ? rawAnswers : {};
  const normalized = {};

  for (const question of questions) {
    let value = answerMap[question.id];
    const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || (question.type === 'CHECKBOX' && value !== true);
    if (question.required && missing) throw Object.assign(new Error(`Please answer: ${question.prompt}`), { statusCode: 400, code: 'SCREENING_ANSWER_REQUIRED' });
    if (missing) continue;

    if (question.type === 'YES_NO' && !['YES', 'NO', true, false].includes(value)) throw Object.assign(new Error(`Invalid answer for: ${question.prompt}`), { statusCode: 400 });
    if (question.type === 'CHECKBOX' && typeof value !== 'boolean') throw Object.assign(new Error(`Invalid confirmation for: ${question.prompt}`), { statusCode: 400 });
    if (question.type === 'NUMBER') {
      const number = Number(value);
      if (!Number.isFinite(number)) throw Object.assign(new Error(`Enter a valid number for: ${question.prompt}`), { statusCode: 400 });
      value = number;
    }
    if (question.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw Object.assign(new Error(`Enter a valid date for: ${question.prompt}`), { statusCode: 400 });
    if (question.type === 'SINGLE_CHOICE' && !question.options.includes(String(value))) throw Object.assign(new Error(`Select a valid option for: ${question.prompt}`), { statusCode: 400 });
    if (question.type === 'MULTI_CHOICE') {
      if (!Array.isArray(value) || value.some((option) => !question.options.includes(String(option)))) throw Object.assign(new Error(`Select valid options for: ${question.prompt}`), { statusCode: 400 });
      value = [...new Set(value.map(String))];
    }
    if (['SHORT_TEXT', 'LONG_TEXT'].includes(question.type)) value = String(value).trim().slice(0, question.type === 'SHORT_TEXT' ? 500 : 5000);
    normalized[question.id] = value;
  }
  return normalized;
};

const pairQuestionsAndAnswers = (questionsInput, answersInput) => {
  const questions = normalizeQuestions(questionsInput || []);
  const answers = parseJson(answersInput, {}) || {};
  return questions.map((question) => ({ ...question, answer: answers[question.id] }));
};

module.exports = { normalizeQuestions, validateAnswers, pairQuestionsAndAnswers };
