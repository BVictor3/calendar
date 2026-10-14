# 📅 Calendar Comun

Calendar pentru doi. Fiecare eveniment poate fi **partajat** (îl vedeți amândoi) sau **privat** (doar tu îl vezi).

- **⏱ Acum**: următorul eveniment cu numărătoare inversă, ora de pregătire și ora de plecare.
- **💌 Mementouri între voi**: trimiți un memento pe evenimentul celuilalt, dacă el sau ea l-a permis. Statusul „a văzut / a plecat / a ajuns” îl vedeți amândoi.
- **Introducere rapidă**: scrii „dentist luni 17” și evenimentul e creat. Ce nu are dată merge în 📥 Inbox.
- Vizualizare pe săptămână și agendă. Merge offline și se instalează pe telefon ca aplicație.

Aplicația e un site static (GitHub Pages). Datele stau în Firebase (Firestore), iar autentificarea se face cu Google.

## Configurare (o singură dată, ~10 minute)

### 1. Proiect Firebase
1. Intră pe <https://console.firebase.google.com> → **Create a project** → nume, de ex. `calendar-comun`. Google Analytics nu e necesar.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, alege emailul de suport → **Save**.
3. **Authentication → Settings → Authorized domains → Add domain**: `bvictor3.github.io`
4. **Build → Firestore Database → Create database**, locație `eur3 (europe-west)`, **production mode**.
5. În Firestore, tab-ul **Rules**: înlocuiește tot cu conținutul din [`firestore.rules`](firestore.rules) → **Publish**.
6. ⚙️ **Project settings → General → Your apps → Web (`</>`)**: înregistrează aplicația (fără Firebase Hosting) și copiază valorile din `firebaseConfig` în [`firebase-config.js`](firebase-config.js).

Valorile din `firebase-config.js` nu sunt secrete. Datele sunt protejate de regulile din `firestore.rules`: evenimentele private nu pot fi citite de nimeni altcineva.

### 2. GitHub Pages
Repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `(root)` → Save**.
După ~1 minut aplicația e la <https://bvictor3.github.io/calendar/>.

### 3. Prima utilizare
1. Deschizi aplicația pe telefon → **Intră cu Google** → **Creează calendarul nostru**.
2. În cardul „Invită-ți partenerul” apeși **Trimite** și trimiți linkul pe WhatsApp.
3. Partenerul deschide linkul, intră cu Google și apasă **Mă alătur**.
4. Pentru instalare: în Chrome, meniul ⋮ → **Adaugă pe ecranul de pornire** (sau **Instalează aplicația**).

## Rulare locală
```bash
python -m http.server 8000
```
Apoi deschizi <http://localhost:8000>. `localhost` e autorizat implicit în Firebase.

## Structură
| Fișier | Rol |
|---|---|
| `index.html`, `style.css`, `app.js` | aplicația |
| `firebase-config.js` | legătura cu proiectul Firebase |
| `firestore.rules` | cine ce poate citi și scrie |
| `sw.js`, `manifest.webmanifest`, `icons/` | instalare pe telefon și funcționare offline |
| `mockup.html` | prototipul inițial, cu toate ideile (doar demo, local) |

## Ce urmează (posibil)
- Notificări push pe telefon și când aplicația e închisă. Necesită Firebase Cloud Functions, adică planul Blaze cu plată la utilizare, practic gratuit pentru doi utilizatori.
- Evenimente recurente.
