export const GENRES = [
  "Romance",
  "Fantasy",
  "Science Fiction",
  "Mystery",
  "Thriller",
  "Horror",
  "Adventure",
  "Historical Fiction",
  "Contemporary Lit",
  "Humor",
  "Poetry",
  "Non-Fiction",
  "Fanfiction",
  "Short Story",
  "Paranormal",
  "Werewolf",
  "LGBTQ+",
  "New Adult",
  "Teen Fiction",
  "Diverse Lit",
  "Others",
] as const;

export const LANGUAGES = [
  "English",
  "Chinese",
  "Korean",
  "Japanese",
  "Spanish",
  "French",
  "Hindi",
  "Arabic",
  "Portuguese",
  "Russian",
  "Others",
] as const;

export type Genre = (typeof GENRES)[number];
export type Language = (typeof LANGUAGES)[number];
