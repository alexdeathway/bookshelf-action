import got from "got/dist/source";

export interface Book {
  kind: "books#volume";
  id: string;
  volumeInfo: {
    title: string;
    authors: string[];
    publisher: string;
    publishedDate: string;
    description: string;
    industryIdentifiers: [
      {
        type: "ISBN_13";
        identifier: string;
      },
      {
        type: "ISBN_10";
        identifier: string;
      }
    ];
    pageCount: number;
    printType: "BOOK";
    categories: string[];
    averageRating: number;
    ratingsCount: number;
    maturityRating: "MATURE" | "NOT_MATURE";
    imageLinks: {
      thumbnail: string;
    };
    language: string;
    previewLink: string;
    infoLink: string;
    canonicalVolumeLink: string;
  };
}

export interface BookResult {
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  description: string;
  image: string;
  language: string;
  averageRating: number;
  ratingsCount: number;
  categories: string[];
  pageCount: number;
  isbn10?: string;
  isbn13?: string;
  googleBooks: {
    id: string;
    preview: string;
    info: string;
    canonical: string;
  };
}

export interface SearchOptions {
  /**
   * The maximum number of results to consider before filtering
   * Default: 10
   */
  maxResults?: number;
  
  /**
   * Filter by exact title match (case-insensitive)
   * Default: false
   */
  exactTitleMatch?: boolean;
  
  /**
   * Filter by minimum average rating
   * Default: 0
   */
  minRating?: number;
  
  /**
   * Set language preference (e.g., 'en')
   */
  language?: string;
}

/**
 * Search for books using the Google Books API
 * @param query The book title or other search terms
 * @param options Additional search options
 * @returns The most relevant book result
 */
export const search = async (query: string, options: SearchOptions = {}): Promise<BookResult> => {
  // Set default options
  const {
    maxResults = 10,
    exactTitleMatch = false,
    minRating = 0,
    language
  } = options;

  // Construct search query with more flexible parameters
  let searchQuery = query;
  
  // If it looks like a title (not an ISBN or complex query), add intitle: prefix
  if (!query.includes(':') && !query.match(/^[0-9-]+$/)) {
    searchQuery = `intitle:"${query}"`;
  }
  
  // Add language filter if specified
  const langParam = language ? `&langRestrict=${language}` : '';
  
  // Request more results to have better filtering options
  const results = await got<{
    items: Book[];
  }>(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchQuery)}${langParam}&maxResults=${maxResults}`, {
    responseType: "json",
  });

  if (!results.body.items || results.body.items.length === 0) {
    console.error("No results found", JSON.stringify(results.body));
    throw new Error("Book not found");
  }

  // Apply additional filtering
  let filteredResults = results.body.items;
  
  // Calculate relevance scores for each book
  const scoredResults = filteredResults.map(book => {
    let score = 0;
    const volumeInfo = book.volumeInfo;
    
    // Base score from Google's ranking
    score += 10;
    
    // Add points for rating count and average rating
    score += (volumeInfo.ratingsCount || 0) / 100; // Normalized rating count
    score += (volumeInfo.averageRating || 0) * 5;  // Weight average rating more heavily
    
    // Title exact match gives big boost
    if (volumeInfo.title && query.toLowerCase().trim() === volumeInfo.title.toLowerCase().trim()) {
      score += 50;
    }
    
    // Title partial match
    else if (volumeInfo.title && volumeInfo.title.toLowerCase().includes(query.toLowerCase())) {
      score += 20;
    }
    
    // More complete book info is preferred
    if (volumeInfo.description) score += 5;
    if (volumeInfo.imageLinks?.thumbnail) score += 5;
    if (volumeInfo.industryIdentifiers?.length > 0) score += 5;
    
    return {
      book,
      score
    };
  });
  
  // Filter by minimum rating if specified
  if (minRating > 0) {
    scoredResults = scoredResults.filter(item => 
      (item.book.volumeInfo.averageRating || 0) >= minRating
    );
  }
  
  // Filter by exact title if requested
  if (exactTitleMatch) {
    const exactMatches = scoredResults.filter(item => 
      item.book.volumeInfo.title.toLowerCase().trim() === query.toLowerCase().trim()
    );
    
    if (exactMatches.length > 0) {
      scoredResults = exactMatches;
    }
  }
  
  // If we have no results after filtering, revert to the original results
  if (scoredResults.length === 0) {
    scoredResults = results.body.items.map(book => ({ book, score: 0 }));
  }
  
  // Sort by score (descending)
  scoredResults.sort((a, b) => b.score - a.score);
  
  // Get the top-scoring result
  const result = scoredResults[0].book;

  return {
    title: result.volumeInfo.title,
    authors: result.volumeInfo.authors || [],
    publisher: result.volumeInfo.publisher || "",
    publishedDate: result.volumeInfo.publishedDate || "",
    description: result.volumeInfo.description || "",
    image:
      (result.volumeInfo.imageLinks || {}).thumbnail ||
      `https://tse2.mm.bing.net/th?q=${encodeURIComponent(
        `${result.volumeInfo.title} by ${(result.volumeInfo.authors || []).join(", ")}`
      )}&w=256&c=7&rs=1&p=0&dpr=3&pid=1.7&mkt=en-IN&adlt=moderate`,
    language: result.volumeInfo.language || "",
    averageRating: result.volumeInfo.averageRating || 0,
    ratingsCount: result.volumeInfo.ratingsCount || 0,
    categories: result.volumeInfo.categories || [],
    pageCount: result.volumeInfo.pageCount || 0,
    isbn10: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_10") || {})
      .identifier,
    isbn13: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_13") || {})
      .identifier,
    googleBooks: {
      id: result.id,
      preview: result.volumeInfo.previewLink || "",
      info: result.volumeInfo.infoLink || "",
      canonical: result.volumeInfo.canonicalVolumeLink || "",
    },
  };
};

/**
 * Search for a book using its ISBN (10 or 13 digit)
 * @param isbn The ISBN number to search for
 * @returns The book with matching ISBN
 */
export const searchByIsbn = async (isbn: string): Promise<BookResult> => {
  // Remove any hyphens
  const cleanIsbn = isbn.replace(/-/g, '');
  
  // Search specifically with ISBN
  const results = await got<{
    items: Book[];
  }>(`https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}`, {
    responseType: "json",
  });

  if (!results.body.items || results.body.items.length === 0) {
    console.error("No results found for ISBN", isbn);
    throw new Error(`Book with ISBN ${isbn} not found`);
  }

  // ISBN should give a precise match, so we just use the first result
  const result = results.body.items[0];

  return {
    title: result.volumeInfo.title,
    authors: result.volumeInfo.authors || [],
    publisher: result.volumeInfo.publisher || "",
    publishedDate: result.volumeInfo.publishedDate || "",
    description: result.volumeInfo.description || "",
    image:
      (result.volumeInfo.imageLinks || {}).thumbnail ||
      `https://tse2.mm.bing.net/th?q=${encodeURIComponent(
        `${result.volumeInfo.title} by ${(result.volumeInfo.authors || []).join(", ")}`
      )}&w=256&c=7&rs=1&p=0&dpr=3&pid=1.7&mkt=en-IN&adlt=moderate`,
    language: result.volumeInfo.language || "",
    averageRating: result.volumeInfo.averageRating || 0,
    ratingsCount: result.volumeInfo.ratingsCount || 0,
    categories: result.volumeInfo.categories || [],
    pageCount: result.volumeInfo.pageCount || 0,
    isbn10: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_10") || {})
      .identifier,
    isbn13: ((result.volumeInfo.industryIdentifiers || []).find((i) => i.type === "ISBN_13") || {})
      .identifier,
    googleBooks: {
      id: result.id,
      preview: result.volumeInfo.previewLink || "",
      info: result.volumeInfo.infoLink || "",
      canonical: result.volumeInfo.canonicalVolumeLink || "",
    },
  };
};
