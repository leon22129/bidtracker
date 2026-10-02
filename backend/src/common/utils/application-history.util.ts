export interface SavedApplicationQuestion {
  question: string;
  options: string[];
}

export interface SavedApplicationAnswer {
  question: string;
  answer: string;
}

export interface SavedApplicationHistory {
  questions: SavedApplicationQuestion[];
  answers: SavedApplicationAnswer[];
}

const MAX_HISTORY_JSON_LENGTH = 500_000;

export function serializeApplicationHistory(
  questions: Array<{ question: string; options?: string[] }>,
  answers: SavedApplicationAnswer[],
) {
  const questionsJson = JSON.stringify(questions.map((item) => ({
    question: item.question,
    options: item.options ?? [],
  })));
  const answersJson = JSON.stringify(answers);
  if (questionsJson.length + answersJson.length > MAX_HISTORY_JSON_LENGTH) {
    throw new Error('Application question history is too large to save');
  }
  return { questionsJson, answersJson };
}

export function parseApplicationHistory(
  questionsJson?: string | null,
  answersJson?: string | null,
): SavedApplicationHistory | null {
  if (!questionsJson || !answersJson) return null;
  const questions = JSON.parse(questionsJson) as unknown;
  const answers = JSON.parse(answersJson) as unknown;
  if (
    !Array.isArray(questions) ||
    !questions.every((item) => (
      item && typeof item === 'object' && typeof item.question === 'string' &&
      Array.isArray(item.options) &&
      item.options.every((option: unknown) => typeof option === 'string')
    )) ||
    !Array.isArray(answers) ||
    !answers.every((item) => (
      item && typeof item === 'object' && typeof item.question === 'string' &&
      typeof item.answer === 'string'
    ))
  ) {
    throw new Error('Saved application question history is invalid');
  }
  return {
    questions: questions as SavedApplicationQuestion[],
    answers: answers as SavedApplicationAnswer[],
  };
}
