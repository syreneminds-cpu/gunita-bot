const admin = require("firebase-admin");
const fs = require('fs');

// 1. Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 2. Configuration
const MESSAGES_PER_RUN = 5;
const REACTIONS_PER_RUN = 15; // React to 15 posts per hour
const TYPES = ["Echoes", "Longing", "Regret", "Hope", "Gratitude", "Nostalgia", "Farewell", "Joy"];

// 3. Load Data Files
let messages = [];
let usernames = [];

try {
  messages = JSON.parse(fs.readFileSync('./bots/messages.json', 'utf8'));
  usernames = JSON.parse(fs.readFileSync('./bots/usernames.json', 'utf8'));
  console.log(`Loaded ${messages.length} messages and ${usernames.length} usernames.`);
} catch (err) {
  console.error("Error reading data files:", err);
  process.exit(1);
}

// Helper: Random Coordinates
function getRandomCoords() {
  const centerLat = 12.8797;
  const centerLng = 121.7740;
  const latOffset = (Math.random() - 0.5) * 3.0;
  const lngOffset = (Math.random() - 0.5) * 3.0;
  return { lat: centerLat + latOffset, lng: centerLng + lngOffset };
}

// --- SMART REACTION LOGIC ---
// Map specific types to specific reactions
const REACTION_MAP = {
    "Hope":      ["heart", "hug"],          // Hopeful messages get Love or Hugs
    "Joy":       ["heart", "haha", "flame"], // Happy messages get Love, Laughs, or Fire
    "Gratitude": ["heart", "flame"],         // Thankful messages get Love or Fire
    "Nostalgia": ["heart", "tear"],          // Nostalgic messages get Love or Tears
    "Longing":   ["tear", "heart"],          // Longing messages get Tears or Love
    "Regret":    ["tear", "hug"],            // Regretful messages get Tears or Hugs
    "Farewell":  ["tear", "hug", "heart"],   // Farewells get Tears, Hugs, or Love
    "Echoes":    ["tear", "heart"]           // Echoes get Tears or Love
};

async function reactToRandomMemory() {
  try {
    // 1. Get recent memories (Limit to 50 for efficiency)
    const snapshot = await db.collection('memories')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    if (snapshot.empty) {
      console.log("No memories found to react to.");
      return;
    }

    // 2. Pick a random memory
    const randomDoc = snapshot.docs[Math.floor(Math.random() * snapshot.docs.length)];
    const memoryData = randomDoc.data();
    const memoryId = randomDoc.id;
    
    // 3. Determine Reaction based on Type
    const memoryType = memoryData.type || "Echoes";
    const possibleReactions = REACTION_MAP[memoryType] || ["heart", "tear"]; // Default fallback
    const reactionKey = possibleReactions[Math.floor(Math.random() * possibleReactions.length)];

    // 4. Update the count in Firestore
    // IMPORTANT: We do NOT write to 'notifications' collection here.
    // This ensures users are not notified of bot activity.
    await db.collection('memories').doc(memoryId).update({
      [`reactions.${reactionKey}`]: admin.firestore.FieldValue.increment(1)
    });

    console.log(`✨ Reacted ${reactionKey} to a memory of type: ${memoryType}`);

  } catch (err) {
    console.error("Error reacting to memory:", err);
  }
}

// 4. Main Logic
async function run() {
  console.log("Starting bot run...");

  // --- PART A: POST NEW MEMORIES ---
  for (let i = 0; i < MESSAGES_PER_RUN; i++) {
    try {
      const username = usernames[Math.floor(Math.random() * usernames.length)];
      const quote = messages[Math.floor(Math.random() * messages.length)];
      const type = TYPES[Math.floor(Math.random() * TYPES.length)];
      const coords = getRandomCoords();
      const email = `bot_${username.replace(/\s/g, '').toLowerCase()}@gunita.test`;

      let userId;
      try {
        const userRecord = await admin.auth().getUserByEmail(email);
        userId = userRecord.uid;
      } catch (error) {
        const newUser = await admin.auth().createUser({
          email: email,
          password: "gunitaBot123!",
          displayName: username
        });
        userId = newUser.uid;
        
        await db.collection('users').doc(userId).set({
            username: username,
            email: email,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            memoriesCount: 0,
            isBot: true
        });

        // Update Keeper Counter
        const statsRef = db.collection('stats').doc('userCount');
        await statsRef.set({
            count: admin.firestore.FieldValue.increment(1)
        }, { merge: true });

        console.log(`Created new user: ${username}`);
      }

      await db.collection('memories').add({
        type: type,
        text: quote,
        user: username,
        userId: userId,
        coords: new admin.firestore.GeoPoint(coords.lat, coords.lng),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reactions: {}
      });

      console.log(`Success: Posted by ${username}`);

    } catch (err) {
      console.error("Error in post loop:", err);
    }
  }

  // --- PART B: SMART REACTIONS ---
  console.log(`Now reacting to ${REACTIONS_PER_RUN} memories...`);
  for (let i = 0; i < REACTIONS_PER_RUN; i++) {
    await reactToRandomMemory();
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("Run complete.");
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
