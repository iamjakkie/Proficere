import type { BookSearchHit, OutlineChapter } from "@progress-island/shared";

const SEARCH_URL = "https://openlibrary.org/search.json";

type OlDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  edition_key?: string[];
  cover_edition_key?: string;
};

type OlEdition = {
  key?: string;
  title?: string;
  table_of_contents?: { title?: string; label?: string; pagenum?: string }[];
  isbn_13?: string[];
  isbn_10?: string[];
  publish_date?: string;
  edition_name?: string;
};

export async function searchCatalog(query: string): Promise<BookSearchHit[]> {
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=8`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error("Open Library search failed. You can still paste a contents list.");
  }
  const body = (await res.json()) as { docs?: OlDoc[] };
  const hits: BookSearchHit[] = [];
  for (const doc of body.docs ?? []) {
    const editionKey = doc.cover_edition_key ?? doc.edition_key?.[0];
    let contents: OutlineChapter[] = [];
    let edition: string | null = null;
    let catalogUrl: string | null = doc.key
      ? `https://openlibrary.org${doc.key}`
      : null;
    if (editionKey) {
      catalogUrl = `https://openlibrary.org/books/${editionKey}`;
      const editionData = await fetchEdition(editionKey);
      if (editionData) {
        edition = editionData.edition_name ?? editionData.publish_date ?? null;
        contents = tocToOutline(editionData.table_of_contents);
      }
    }
    hits.push({
      catalogId: doc.key ?? editionKey ?? doc.title ?? crypto.randomUUID(),
      title: doc.title ?? "Untitled",
      author: doc.author_name?.[0] ?? null,
      edition,
      isbn: doc.isbn?.[0] ?? null,
      year: doc.first_publish_year ? String(doc.first_publish_year) : null,
      catalogUrl,
      contentsAvailable: contents.length > 0,
      contentsPreview: contents.length > 0 ? contents : undefined,
    });
  }
  return hits;
}

async function fetchEdition(editionKey: string): Promise<OlEdition | null> {
  const res = await fetch(`https://openlibrary.org/books/${editionKey}.json`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as OlEdition;
}

function tocToOutline(
  toc: OlEdition["table_of_contents"],
): OutlineChapter[] {
  if (!toc?.length) return [];
  return toc
    .filter((row) => row.title?.trim())
    .map((row) => ({
      number: row.label ?? null,
      title: row.title!.trim(),
      pageStart: row.pagenum ?? null,
      pageEnd: null,
    }));
}
