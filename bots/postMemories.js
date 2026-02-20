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

// 4. Main Logic
async function run() {
  console.log("Starting bot run...");

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
        
        // UPDATE THE KEEPER COUNTER
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
      console.error("Error:", err);
    }
  }
  console.log("Run complete.");
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
