/**
 * Smart skill classifier to distinguish remote/digital skills from physical ones.
 * Remote skills bypass local city/area filtering.
 */

const REMOTE_KEYWORDS = [
  'web', 'design', 'software', 'development', 'programming', 'developer',
  'graphic', 'logo', 'marketing', 'translation', 'writing', 'copywriter',
  'seo', 'accounting', 'bookkeeping', 'virtual assistant', 'social media',
  'freelancer', 'content creator', 'tutor', 'teacher', 'coding', 'editor',
  'video editing'
];

/**
 * Checks if a skill name is a remote/digital skill.
 * @param {string} skillName 
 * @returns {boolean}
 */
const isRemoteSkill = (skillName) => {
  if (!skillName) return false;
  const s = skillName.toLowerCase().trim();
  return REMOTE_KEYWORDS.some(keyword => s.includes(keyword));
};

module.exports = {
  isRemoteSkill
};
