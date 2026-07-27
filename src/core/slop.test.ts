import { describe, expect, it } from 'vitest';
import {
  BANNED_WORDS_EN,
  BANNED_WORDS_ES,
  findBannedWords,
  findEmDashes,
  isSlopFree,
} from './slop';

const BANNED_WORDS = BANNED_WORDS_EN;

describe('the banned-word list', () => {
  // Pinned, not counted. SLICE-4 requires this list to match the writing-voice
  // skill verbatim, so a change here should be a deliberate edit to a test, not
  // something that slips through because the length still looks right.
  it('is the writing-voice list, in order', () => {
    expect([...BANNED_WORDS]).toEqual([
      'leverage',
      'robust',
      'delve',
      'tapestry',
      'passionate',
      'dynamic',
      'seamless',
      'seamlessly',
      'spearheaded',
      'synergy',
      'holistic',
      'cutting-edge',
      'best-in-class',
      'game-changer',
      'elevate',
      'empower',
      'unlock',
      'embark',
      'journey',
      'landscape',
      'realm',
      'testament',
      'meticulous',
      'bustling',
    ]);
  });

  for (const word of BANNED_WORDS) {
    it(`flags ${word}`, () => {
      expect(findBannedWords(`I would ${word} that.`)).toHaveLength(1);
    });
  }
});

describe('findBannedWords', () => {
  const inflected = [
    'leveraging',
    'leveraged',
    'delving',
    'empowered',
    'unlocks',
    'elevating',
    'journeys',
    'spearheaded',
  ];

  for (const word of inflected) {
    it(`catches the inflected form ${word}`, () => {
      expect(findBannedWords(`We ${word} the thing.`)).toHaveLength(1);
    });
  }

  it('is case insensitive', () => {
    expect(findBannedWords('Robust and ROBUST and robust')).toHaveLength(3);
  });

  it('reports where each one is', () => {
    const [first] = findBannedWords('A robust plan.');
    expect(first).toEqual({ term: 'robust', index: 2 });
  });

  it('does not fire on a word that merely contains one', () => {
    expect(findBannedWords('The journeyman was unlockable.')).toHaveLength(0);
  });

  it('passes plain writing', () => {
    expect(
      findBannedWords('I cut the month-end close from three days to one.'),
    ).toEqual([]);
  });
});

describe('the Spanish banned-word list', () => {
  // Pinned exactly like the English one. Its author curates it; nothing here
  // trims an entry to silence a collision.
  it('is the authored list, in order', () => {
    expect([...BANNED_WORDS_ES]).toEqual([
      'sinergia',
      'apalancar',
      'robusto',
      'holístico',
      'apasionado',
      'proactivo',
      'dinámico',
      'disruptivo',
      'vanguardista',
      'potenciar',
      'empoderar',
      'impulsar',
      'desbloquear',
      'embarcar',
      'travesía',
      'panorama',
      'entramado',
      'meticuloso',
      'bullicioso',
      'punta de lanza',
      'de clase mundial',
      'orientado a resultados',
      'un antes y un después',
      'en la era digital',
      'en un mundo cada vez más',
      'cabe destacar',
      'no es solo',
      'clave del éxito',
      'llevar al siguiente nivel',
      'marcar la diferencia',
    ]);
  });

  for (const entry of BANNED_WORDS_ES) {
    it(`flags ${entry}`, () => {
      expect(findBannedWords(`Texto con ${entry} dentro.`)).toHaveLength(1);
    });
  }
});

describe('Spanish morphology', () => {
  const inflected: Record<string, string[]> = {
    // Gender and number on an adjective.
    apasionado: ['apasionada', 'apasionados', 'apasionadas'],
    holístico: ['holística', 'holísticos', 'holísticas'],
    meticuloso: ['meticulosa', 'meticulosos'],
    // Plural on a noun.
    sinergia: ['sinergias'],
    travesía: ['travesías'],
    // Verb stems across tense and person.
    potenciar: ['potencié', 'potenciando', 'potenciamos', 'potenciaron'],
    empoderar: ['empoderado', 'empoderaba', 'empoderará'],
    impulsar: ['impulsando', 'impulsaron', 'impulsaría'],
  };

  for (const [base, forms] of Object.entries(inflected)) {
    for (const form of forms) {
      it(`catches ${form} from ${base}`, () => {
        expect(findBannedWords(`Lo ${form} el equipo.`)).toHaveLength(1);
      });
    }
  }

  it('catches an accented word typed without its accent', () => {
    expect(findBannedWords('un enfoque holistico')).toHaveLength(1);
    expect(findBannedWords('un equipo dinamico')).toHaveLength(1);
  });

  it('reports the term as it appeared, not as it was folded', () => {
    const [first] = findBannedWords('Un enfoque holístico.');
    expect(first.term).toBe('holístico');
    expect(first.index).toBe(11);
  });

  it('matches multi-word idioms as substrings, case insensitively', () => {
    expect(findBannedWords('Cabe destacar que funciona.')).toHaveLength(1);
    expect(findBannedWords('esto no es solo un trabajo')).toHaveLength(1);
    expect(findBannedWords('la CLAVE DEL ÉXITO')).toHaveLength(1);
  });

  it('runs both lists on one document regardless of language', () => {
    expect(findBannedWords('A robust sinergia between teams.')).toHaveLength(2);
  });

  it('passes a clean Spanish sentence written in voseo', () => {
    const text =
      'Vos armaste el informe mensual y lo entregaste en tres días. Bajaste el cierre de tres días a uno.';
    expect(findBannedWords(text)).toEqual([]);
    expect(isSlopFree(text)).toBe(true);
  });
});

// Documented, not decided. The list belongs to its author; these tests pin what
// the matcher currently does so the collisions are visible and can be curated.
describe('known Spanish collisions', () => {
  it('flags dinámica used as a noun, not an adjective', () => {
    // "dinámicas de grupo" is ordinary Spanish, not slop, but it is the
    // feminine of `dinámico` and the matcher cannot tell them apart.
    expect(findBannedWords('las dinámicas de grupo del equipo')).toHaveLength(
      1,
    );
  });

  it('flags panorama in a legitimate use', () => {
    // "el panorama político" is normal register.
    expect(findBannedWords('el panorama político del país')).toHaveLength(1);
  });

  it('flags potencia and impulso, the nouns behind two listed verbs', () => {
    // Both are ordinary words that collide with a conjugation of the verb.
    expect(findBannedWords('la potencia del motor')).toHaveLength(1);
    expect(findBannedWords('el impulso inicial')).toHaveLength(1);
    expect(findBannedWords('el desbloqueo de la cuenta')).toHaveLength(1);
  });

  it('does not flag derived nouns that fall outside the conjugation', () => {
    // The ending lists are enumerated rather than open-ended, so these stay
    // clean: apalancamiento is a real finance term and potencial is ordinary.
    expect(findBannedWords('el apalancamiento financiero')).toEqual([]);
    expect(findBannedWords('un cliente potencial')).toEqual([]);
    expect(findBannedWords('el empoderamiento de la comunidad')).toEqual([]);
  });

  it('misses gendered variants of the multi-word idioms', () => {
    // "orientado a resultados" is matched as a fixed string, so the feminine
    // form slips through. Surfaced rather than patched: changing it means
    // changing what a multi-word entry means.
    expect(findBannedWords('orientado a resultados')).toHaveLength(1);
    expect(findBannedWords('orientada a resultados')).toEqual([]);
  });
});

describe('findEmDashes', () => {
  it('flags an em dash', () => {
    expect(findEmDashes('I built it — and it worked.')).toHaveLength(1);
  });

  it('flags an en dash used as a dash', () => {
    expect(findEmDashes('I built it – and it worked.')).toHaveLength(1);
  });

  it('flags an en dash between words', () => {
    expect(findEmDashes('sales–marketing handoff')).toHaveLength(1);
  });

  // A resume is full of these. Flagging them would train people to ignore the
  // gate, which costs more than the rare en dash it would catch.
  it('leaves a numeric range alone', () => {
    expect(findEmDashes('2020–2024')).toEqual([]);
  });

  // Measured, not assumed: the first real apply run wrote all three of its
  // roles this way, so the unspaced form on its own is not the rule people
  // actually write.
  it('leaves a spaced date range alone', () => {
    expect(findEmDashes('FoodStyles | 2024 – Present')).toEqual([]);
    expect(findEmDashes('FoodStyles | 2022 – 2024')).toEqual([]);
  });

  it('leaves a hyphen alone', () => {
    expect(findEmDashes('month-end close, self-healing jobs')).toEqual([]);
  });

  it('finds every one, not just the first', () => {
    expect(findEmDashes('one — two — three')).toHaveLength(2);
  });
});

describe('isSlopFree', () => {
  it('passes plain, specific writing', () => {
    expect(
      isSlopFree(
        'I led the on-call rotation for the payments service. I cut the month-end close from three days to one.',
      ),
    ).toBe(true);
  });

  it('fails on a banned word', () => {
    expect(isSlopFree('A robust solution.')).toBe(false);
  });

  it('fails on an em dash', () => {
    expect(isSlopFree('It shipped — on time.')).toBe(false);
  });

  it('does not carry state between calls', () => {
    const text = 'A robust plan.';
    expect(isSlopFree(text)).toBe(false);
    expect(isSlopFree(text)).toBe(false);
  });
});
