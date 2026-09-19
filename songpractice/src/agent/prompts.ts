/** Shared prompt and output contract for both LLM backends. */

export const SUBMIT_TOOL_NAME = 'submit_song';

export const SYSTEM_PROMPT = `You are a musical transcription assistant for a practice app. Given a song name, you research the song on the web and return its chord progression and main melody in a strict format.

Method:
1. Search for the song's chords. Chord sheets, tab sites, song analysis pages and "what key is X in" pages are all useful.
2. Search separately for the melody: sheet music, "notes for", solfege or letter-note tutorials, or a description of the vocal line.
3. Open the most promising pages to read the actual chords and notes. Do not rely on search snippets alone when a page can be opened.
4. Call ${SUBMIT_TOOL_NAME} exactly once with your best transcription.

Rules for the data you submit:
- Chord symbols must be plain text like C, Am, F#m7b5, Bbmaj7, G7sus4, D/F#. Do not invent notation.
- "beats" counts beats of the time signature's lower number: in 4/4 a beat is a quarter note, in 6/8 a beat is an eighth note. A whole bar of 4/4 is 4 beats.
- Melody notes are scientific pitch names with an octave: C4 is middle C. Use "rest" for a silence.
- Keep the melody in a singable range, roughly C3 to C6, and consistent with the key you report.
- The chords and the melody of a section should cover the SAME number of beats. Pad the melody with rests if it is shorter.
- Prefer 1-3 sections (for example Verse, Chorus, Bridge). Each section should be a complete musical phrase, typically 8-16 bars, not the whole song repeated.
- If you cannot find a reliable melody, still submit the chords and give an empty melody array for that section rather than inventing a melody that does not exist.
- Report confidence honestly and list the URLs you actually used.

Do not ask the user questions. Do not return the answer as prose: the only way to finish is to call ${SUBMIT_TOOL_NAME}.`;

export function userPrompt(query: string): string {
  return `Find the chords and melody for: ${query}

Search the web, read the best sources, then call ${SUBMIT_TOOL_NAME}.`;
}

/** JSON Schema for the submit tool. Kept flat and string-typed for portability. */
export const SUBMIT_SCHEMA = {
  type: 'object',
  properties: {
    title: {type: 'string', description: 'Song title as commonly written'},
    artist: {type: 'string', description: 'Performing artist or composer'},
    key: {
      type: 'string',
      description: "Key and mode, e.g. 'C major', 'F# minor', 'D dorian', 'A mixolydian'",
    },
    tempo: {type: 'number', description: 'Beats per minute, 40-220'},
    timeSignature: {type: 'string', description: "e.g. '4/4', '3/4', '6/8'"},
    sections: {
      type: 'array',
      description: 'One entry per distinct section of the song',
      items: {
        type: 'object',
        properties: {
          name: {type: 'string', description: "e.g. 'Verse', 'Chorus', 'Bridge'"},
          chords: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                symbol: {type: 'string', description: "Chord symbol, e.g. 'Am7'"},
                beats: {type: 'number', description: 'Length in beats'},
              },
              required: ['symbol', 'beats'],
              additionalProperties: false,
            },
          },
          melody: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                note: {type: 'string', description: "Pitch with octave, e.g. 'A4', or 'rest'"},
                beats: {type: 'number', description: 'Length in beats'},
                lyric: {type: 'string', description: 'Syllable sung on this note, optional'},
              },
              required: ['note', 'beats'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'chords', 'melody'],
        additionalProperties: false,
      },
    },
    sources: {type: 'array', items: {type: 'string'}, description: 'URLs actually used'},
    confidence: {type: 'string', enum: ['high', 'medium', 'low']},
    notes: {type: 'string', description: 'Anything the practising musician should know'},
  },
  required: ['title', 'artist', 'key', 'tempo', 'timeSignature', 'sections'],
  additionalProperties: false,
} as const;

export const SEARCH_SCHEMA = {
  type: 'object',
  properties: {query: {type: 'string', description: 'Search query'}},
  required: ['query'],
  additionalProperties: false,
} as const;

export const OPEN_SCHEMA = {
  type: 'object',
  properties: {url: {type: 'string', description: 'Absolute http(s) URL from a previous search'}},
  required: ['url'],
  additionalProperties: false,
} as const;
