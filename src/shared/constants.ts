export const ANEX_URL = 'https://anex.us/grades/getData/';
export const RMP_URL = 'https://www.ratemyprofessors.com/graphql';
export const RMP_SCHOOL_ID = 'U2Nob29sLTEwMDM='; // TAMU College Station
export const RMP_AUTH = 'Basic dGVzdDp0ZXN0';

export const GRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RMP_TTL_MS = 24 * 60 * 60 * 1000;

export const RMP_PRIOR_MEAN = 3.5;
export const RMP_PRIOR_WEIGHT = 10;

export const DEPT_KEYWORDS: Record<string, string> = {
  CSCE: 'computer', ECEN: 'electrical', MEEN: 'mechanical', CHEN: 'chemical',
  CVEN: 'civil', AERO: 'aerospac', NUEN: 'nuclear', ISEN: 'industrial',
  PETE: 'petroleum', OCEN: 'ocean', MATH: 'math', STAT: 'stat',
  PHYS: 'physic', CHEM: 'chem', BIOL: 'biol', BIMS: 'biomed', BMEN: 'biomed',
  ENGL: 'english', POLS: 'politic', HIST: 'hist', PSYC: 'psych',
  ECON: 'econ', ACCT: 'account', FINC: 'financ', MGMT: 'manag', MKTG: 'market',
};

export const RMP_QUERY = `
  query SearchTeacher($text: String!, $schoolID: ID!) {
    newSearch {
      teachers(query: {text: $text, schoolID: $schoolID}, first: 5) {
        edges {
          node { firstName lastName avgRating numRatings department }
        }
      }
    }
  }
`;
