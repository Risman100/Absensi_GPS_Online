import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB5tgF8y73Yt55xfprlXpjlTn-c_OXTf9k",
  authDomain: "absensigpsonline.firebaseapp.com",
  projectId: "absensigpsonline",
  storageBucket: "absensigpsonline.firebasestorage.app",
  messagingSenderId: "763402474543",
  appId: "1:763402474543:web:172b892cedffcff471e2da",
  measurementId: "G-5ECKXHDXYD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth
export const auth = getAuth(app);
