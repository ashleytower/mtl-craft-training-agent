import { google } from 'googleapis';

const SPREADSHEET_ID = '1NsJ2tAsQV2eaI1llNSEsxibrNxI3B4Vl-fLHzDC1NSc';

// Initialize Google Sheets API with API key (simpler for read-only public sheets)
function getSheetsClient() {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is not configured');
  }
  
  return google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
}

export interface CocktailData {
  id: string;
  name: string;
  nom: string;
  category: string;
  baseSpirit: string;
  glassware: string;
  descriptionEN: string;
  descriptionFR: string;
  funFacts: string;
  seasonal?: string;
  isSignature?: boolean;
}

/**
 * Fetch all cocktails from the Cocktails sheet
 */
export async function getCocktails(): Promise<CocktailData[]> {
  try {
    const sheets = getSheetsClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Cocktails!A2:K100', // Skip header row, get data
    });

    const rows = response.data.values || [];
    
    return rows
      .filter(row => row[0]) // Filter out empty rows
      .map(row => ({
        id: row[0] || '',
        name: row[1] || '',
        nom: row[2] || '',
        category: row[3] || '',
        baseSpirit: row[4] || '',
        glassware: row[5] || '',
        descriptionEN: row[6] || '',
        descriptionFR: row[7] || '',
        funFacts: row[8] || '',
        seasonal: row[9] || '',
        isSignature: row[10] === 'TRUE',
      }));
  } catch (error) {
    console.error('Error fetching cocktails from Google Sheets:', error);
    throw error;
  }
}

/**
 * Search cocktails by name (English or French)
 */
export async function searchCocktailsByName(query: string): Promise<CocktailData[]> {
  const cocktails = await getCocktails();
  const lowerQuery = query.toLowerCase();
  
  return cocktails.filter(cocktail =>
    cocktail.name.toLowerCase().includes(lowerQuery) ||
    cocktail.nom.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get ingredients for a specific cocktail from knowledge base
 * Note: The ingredients are in a complex format in the knowledge base
 * For now, we'll return a simplified structure
 */
export async function getIngredients(cocktailName: string): Promise<Array<{
  ingredient: string;
  amount: string | null;
  unit: string | null;
}>> {
  // This would need to parse the complex recipe format from the knowledge base
  // For now, return empty array and rely on AI to extract from knowledge
  return [];
}

/**
 * Get preparation steps for a cocktail
 */
export async function getPreparationSteps(cocktailName: string, language: 'en' | 'fr' = 'en'): Promise<string> {
  // The preparation steps are in the knowledge base in a complex format
  // For now, return empty and let AI handle it from knowledge
  return '';
}
