import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);

const db = drizzle(connection);

// Cocktail recipes data from knowledge base
const cocktailData = [
  {
    name: "the butterfly",
    nameEnglish: "The Butterfly",
    descriptionEnglish: "Butterfly pea, lemon, Gin, Eggwhites",
    descriptionFrench: "Pois de papillion, citron, Gin, blanc d'oeufs",
    funFacts: "This is Our Most Popular Cocktail. Once we start serving it, everyone wants to try one. It's strong and lightly floral. We make our syrup in big batches, it is a simple syrup and we soak the butterfly peas in the syrup. Created by Mtl Craft cocktails.",
    method: "ADD all ingredientes to the shaker. DRY SHAKE for 15 seconds. ADD ice and SHAKE again. POUR into a glass. TOP with more ice if needed. GARNISH.",
    glassType: "low ball",
    ingredients: [
      { type: "alcool", withAlcohol: true, amount: "2", unit: "oz", ingredient: "gin" },
      { type: "syrup", withAlcohol: true, amount: "0.75", unit: "oz", ingredient: "butterfly pea syrup" },
      { type: "juice", withAlcohol: true, amount: "0.75", unit: "oz", ingredient: "lemon juice" },
      { type: "juice", withAlcohol: true, amount: "1", unit: "splash", ingredient: "eggwhite" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "garnish", ingredient: "pea flowers" },
      { type: "syrup", withAlcohol: false, amount: "1", unit: "oz", ingredient: "butterfly pea syrup" },
      { type: "juice", withAlcohol: false, amount: "0.5", unit: "oz", ingredient: "lemon juice" },
      { type: "alcool", withAlcohol: false, amount: "2", unit: "oz", ingredient: "water" },
    ]
  },
  {
    name: "spicy margarita",
    nameEnglish: "Spicy Margarita",
    descriptionEnglish: "Jalapeno syrup, lime, triple sec, tequila",
    descriptionFrench: "Syrop de jalapeno, citron vert, triple sec, tequila",
    funFacts: "We make our spicy margarita with a jalapeno syrup that we blend and then pass through a cheese cloth so we don't just get the heat but the flavor of the jalapeno as well.",
    method: "RIM half the glass with tajin. ADD all ingredientes to the shaker and fill with ice. SHAKE for 15 seconds. POUR into a glass with fresh ice. TOP with more ice if needed. GARNISH.",
    glassType: "low ball",
    ingredients: [
      { type: "alcool", withAlcohol: true, amount: "1.5", unit: "oz", ingredient: "tequila" },
      { type: "alcool", withAlcohol: true, amount: "0.5", unit: "oz", ingredient: "triple sec" },
      { type: "syrup", withAlcohol: true, amount: "0.5", unit: "oz", ingredient: "jalapeno syrup" },
      { type: "juice", withAlcohol: true, amount: "0.75", unit: "oz", ingredient: "lime juice" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "garnish", ingredient: "dehydrated citrus" },
      { type: "alcool", withAlcohol: false, amount: "2", unit: "oz", ingredient: "water" },
      { type: "syrup", withAlcohol: false, amount: "1", unit: "oz", ingredient: "jalapeno syrup" },
      { type: "juice", withAlcohol: false, amount: "0.75", unit: "oz", ingredient: "lime" },
    ]
  },
  {
    name: "mojito",
    nameEnglish: "Mojito",
    descriptionEnglish: "Mint, Lime, Rum, Soda",
    descriptionFrench: "Menthe, Citron vert, Rhum, soda",
    funFacts: "When making a mojito it is important not to muddle the mint hard. A gental press is enought! Ever have a mojito that tastes like metal? that's because they have butchered the mint!",
    method: "MUDDLE mint in simple syrup. ADD lime and rum. ADD lots of ice and stir ADD more ice and top with club soda. GARNISH",
    glassType: "highball",
    ingredients: [
      { type: "alcool", withAlcohol: true, amount: "2", unit: "oz", ingredient: "rum" },
      { type: "syrup", withAlcohol: true, amount: "1", unit: "oz", ingredient: "mint syrup" },
      { type: "juice", withAlcohol: true, amount: "0.75", unit: "oz", ingredient: "lime juice" },
      { type: "others", withAlcohol: true, amount: "15", unit: "units", ingredient: "leaves of mint" },
      { type: "soda", withAlcohol: true, amount: "1", unit: "oz", ingredient: "club soda" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "garnish", ingredient: "dehydrated citrus" },
      { type: "alcool", withAlcohol: false, amount: "2", unit: "oz", ingredient: "water" },
      { type: "syrup", withAlcohol: false, amount: "1", unit: "oz", ingredient: "simple syrup" },
      { type: "juice", withAlcohol: false, amount: "1", unit: "oz", ingredient: "lime juice" },
      { type: "soda", withAlcohol: false, amount: "2", unit: "oz", ingredient: "club soda" },
    ]
  },
  {
    name: "margarita",
    nameEnglish: "Margarita",
    descriptionEnglish: "Agave, lime, triple sec, tequila",
    descriptionFrench: "Agave, citron vert, triple sec, Tequila",
    funFacts: "The daisy cocktail was made with brandy, Cointreau, and lime juice. Bartenders began replacing the brandy with tequila, turning it into a tequila-based cocktail with the same ingredients as the margarita. As 'margarita' is Spanish for 'daisy,' the margarita can be seen as an evolution of the daisy cocktail. The earliest claim someone made to have invented the margarita was in 1938 by Carlos 'Danny' Herrera. He owned the restaurant Rancho La Gloria in Tijuana, Mexico. He claimed to have created the drink for a dancer, Marjorie King, who couldn't drink any liquor apart from tequila.",
    method: "RIM half the glass with salt. ADD all ingredientes to the shaker and fill with ice. SHAKE for 15 seconds. POUR into a glass with fresh ice. TOP with more ice if needed. GARNISH.",
    glassType: "low ball",
    ingredients: [
      { type: "alcool", withAlcohol: true, amount: "1.5", unit: "oz", ingredient: "tequila" },
      { type: "alcool", withAlcohol: true, amount: "0.5", unit: "oz", ingredient: "triple sec" },
      { type: "syrup", withAlcohol: true, amount: "0.5", unit: "oz", ingredient: "simple syrup" },
      { type: "juice", withAlcohol: true, amount: "0.75", unit: "oz", ingredient: "lime juice" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "unit", ingredient: "rim of salt" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "garnish", ingredient: "dehydrated citrus" },
      { type: "alcool", withAlcohol: false, amount: "2", unit: "oz", ingredient: "water" },
      { type: "syrup", withAlcohol: false, amount: "1", unit: "oz", ingredient: "simple syrup" },
      { type: "juice", withAlcohol: false, amount: "1", unit: "oz", ingredient: "lime juice" },
    ]
  },
  {
    name: "old fashioned",
    nameEnglish: "Old Fashioned",
    descriptionEnglish: "Sugar, Bitters, Bourbon, Orange Zest",
    descriptionFrench: "Sucre, amer, Bourbon, zeste d'orange",
    funFacts: "",
    method: "ADD all ingredientes to a mixing glass except the orange and stir with lots of ice. STRAIN into a glass. TOP with more ice if needed. GARNISH with an orange twist.",
    glassType: "low ball",
    ingredients: [
      { type: "alcool", withAlcohol: true, amount: "2", unit: "oz", ingredient: "bourbon" },
      { type: "syrup", withAlcohol: true, amount: "0.25", unit: "oz", ingredient: "simple syrup" },
      { type: "garnish", withAlcohol: true, amount: "1", unit: "garnish", ingredient: "orange peel" },
      { type: "garnish", withAlcohol: true, amount: "3", unit: "garnish", ingredient: "bitters" },
    ]
  }
];

// Packing checklist data from knowledge base
const packingData = [
  // BAR ITEMS
  { category: "BAR ITEMS", itemName: "Bar mats", quantityFormula: "1 per person + 1", notes: null },
  { category: "BAR ITEMS", itemName: "Shakers", quantityFormula: "1 per person", notes: null },
  { category: "BAR ITEMS", itemName: "Jiggers", quantityFormula: "1 per person", notes: null },
  { category: "BAR ITEMS", itemName: "Strainers", quantityFormula: "1 per person", notes: null },
  { category: "BAR ITEMS", itemName: "Big spoons", quantityFormula: "1 per person", notes: null },
  { category: "BAR ITEMS", itemName: "Pourers", quantityFormula: "10", notes: null },
  { category: "BAR ITEMS", itemName: "Ice scoops", quantityFormula: "2", notes: null },
  { category: "BAR ITEMS", itemName: "Cooler", quantityFormula: "2", notes: null },
  { category: "BAR ITEMS", itemName: "Ice", quantityFormula: "As needed", notes: null },
  { category: "BAR ITEMS", itemName: "Knife", quantityFormula: "1", notes: null },
  { category: "BAR ITEMS", itemName: "Garnish tongs", quantityFormula: "1", notes: null },
  
  // COCKTAIL STUFF
  { category: "COCKTAIL STUFF", itemName: "Small garnish jars", quantityFormula: "1 per 5 people", notes: null },
  { category: "COCKTAIL STUFF", itemName: "Club soda/Tonic", quantityFormula: "As needed", notes: null },
  { category: "COCKTAIL STUFF", itemName: "Cups (glasses)", quantityFormula: "1 per person", notes: null },
  { category: "COCKTAIL STUFF", itemName: "Cheat sheet", quantityFormula: "1", notes: null },
  { category: "COCKTAIL STUFF", itemName: "Syrup to sell", quantityFormula: "As needed", notes: null },
  
  // MATERIALS
  { category: "MATERIALS", itemName: "Trolley", quantityFormula: "1", notes: null },
  { category: "MATERIALS", itemName: "Black garbage bags", quantityFormula: "Several", notes: null },
  { category: "MATERIALS", itemName: "Mini towels", quantityFormula: "2", notes: null },
  { category: "MATERIALS", itemName: "Dump buckets", quantityFormula: "2", notes: null },
  
  // WOOD CRATE
  { category: "WOOD CRATE", itemName: "Straws in a jar", quantityFormula: "1 jar", notes: null },
  { category: "WOOD CRATE", itemName: "Big jar of citrus", quantityFormula: "1", notes: null },
  { category: "WOOD CRATE", itemName: "Business card", quantityFormula: "Several", notes: null },
  { category: "WOOD CRATE", itemName: "Plants", quantityFormula: "2, more if big workshop", notes: null },
  { category: "WOOD CRATE", itemName: "Brown Candles", quantityFormula: "2", notes: null },
  { category: "WOOD CRATE", itemName: "Small candles", quantityFormula: "2-4", notes: null },
  { category: "WOOD CRATE", itemName: "Shaker with tajin/salt", quantityFormula: "1", notes: null },
  { category: "WOOD CRATE", itemName: "Garnishes", quantityFormula: "As needed", notes: null },
  { category: "WOOD CRATE", itemName: "Bitters", quantityFormula: "As needed", notes: null },
];

async function seed() {
  console.log("Starting database seeding...");
  
  try {
    // Seed cocktails and ingredients
    console.log("Seeding cocktails...");
    for (const cocktail of cocktailData) {
      const { ingredients: ingredientsList, ...cocktailInfo } = cocktail;
      
      const [result] = await connection.execute(
        `INSERT INTO cocktails (name, nameEnglish, descriptionEnglish, descriptionFrench, funFacts, method, glassType) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [cocktailInfo.name, cocktailInfo.nameEnglish, cocktailInfo.descriptionEnglish, cocktailInfo.descriptionFrench, cocktailInfo.funFacts, cocktailInfo.method, cocktailInfo.glassType]
      );
      const cocktailId = result.insertId;
      
      console.log(`  - Inserted cocktail: ${cocktail.name} (ID: ${cocktailId})`);
      
      // Insert ingredients for this cocktail
      for (const ingredient of ingredientsList) {
        await connection.execute(
          `INSERT INTO ingredients (cocktailId, type, withAlcohol, amount, unit, ingredient) VALUES (?, ?, ?, ?, ?, ?)`,
          [cocktailId, ingredient.type, ingredient.withAlcohol, ingredient.amount, ingredient.unit, ingredient.ingredient]
        );
      }
    }
    
    // Seed packing items
    console.log("Seeding packing items...");
    for (const item of packingData) {
      await connection.execute(
        `INSERT INTO packingItems (category, itemName, quantityFormula, notes) VALUES (?, ?, ?, ?)`,
        [item.category, item.itemName, item.quantityFormula, item.notes]
      );
    }
    console.log(`  - Inserted ${packingData.length} packing items`);
    
    console.log("Database seeding completed successfully!");
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

seed();
