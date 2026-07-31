import { describe, expect, it } from 'vitest';
import { detectPostingLanguage } from './detect-language';

const ENGLISH_POSTING = `
We are looking for a Senior Backend Engineer to join our growing team. You
will design and build scalable services, collaborate with product and
design, and mentor junior engineers. Requirements: five or more years of
experience with distributed systems, strong communication skills, and a
passion for clean code. We offer competitive pay, remote work, and a
supportive culture.
`;

const SPANISH_POSTING = `
Buscamos un Ingeniero de Backend Senior para sumarse a nuestro equipo en
crecimiento. Vas a diseñar y construir servicios escalables, colaborar con
los equipos de producto y diseño, y guiar a ingenieros junior. Requisitos:
más de cinco años de experiencia con sistemas distribuidos, buenas
habilidades de comunicación y pasión por el código limpio. Ofrecemos un
salario competitivo, trabajo remoto y una cultura de apoyo.
`;

describe('detectPostingLanguage', () => {
  it('reads a real English posting as English', () => {
    expect(detectPostingLanguage(ENGLISH_POSTING, 'es')).toBe('en');
  });

  it('reads a real Spanish posting as Spanish', () => {
    expect(detectPostingLanguage(SPANISH_POSTING, 'en')).toBe('es');
  });

  it('falls back on an empty box', () => {
    expect(detectPostingLanguage('', 'en')).toBe('en');
    expect(detectPostingLanguage('', 'es')).toBe('es');
  });

  it('falls back on text too short to judge', () => {
    expect(detectPostingLanguage('Backend Engineer, Remote', 'es')).toBe('es');
  });

  it('a lone Spanish-only character outweighs a close stopword count', () => {
    // "el" reads English-leaning on its own; "código" settles it.
    expect(
      detectPostingLanguage(
        'el equipo el equipo el equipo the the the código',
        'en',
      ),
    ).toBe('es');
  });
});
