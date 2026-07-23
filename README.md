# Mock IELTS Examination Platform

An online IELTS examination platform designed to simulate the official IELTS testing experience. The project allows students to complete Reading, Listening, and Writing tasks through a web browser while providing teachers with a centralised system for managing results.

## Live Demo

https://mock-exam-12i.pages.dev/

## Features

- Full browser-based IELTS examination interface
- Reading module with multiple question types
- Listening module with integrated audio playback
- Writing Task 1 and Task 2 editor
- Automatic answer submission
- AI-assisted writing evaluation using the OpenAI API
- Cloudflare Workers backend
- Cloudflare D1 database for storing submissions
- Cloudflare R2 storage support for media files
- Responsive interface for desktop and tablet devices
- Secure server-side API key handling using Cloudflare Secrets

## Technologies Used

- HTML5
- CSS3
- JavaScript (ES6)
- Cloudflare Pages
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- OpenAI API
- Git
- GitHub

## Project Structure

```text
mock-exam/
│
├── index.html
├── reading.html
├── listening.html
├── writing.html
├── css/
├── js/
├── worker.js
├── wrangler.json
├── package.json
└── README.md
```

## How It Works

Students complete the examination through a web interface.

When the examination is submitted:

1. Reading answers are recorded.
2. Writing responses are sent securely to a Cloudflare Worker.
3. The Worker communicates with the OpenAI API.
4. AI-generated feedback is returned.
5. Results are stored in Cloudflare D1 for later review.

## Local Development

Clone the repository:

```bash
git clone https://github.com/CoderinaPurpr/mock-exam.git
```

Install dependencies:

```bash
npm install
```

Create a `.dev.vars` file:

```text
OPENAI_API_KEY=your_api_key_here
```

Run the local development server:

```bash
npm run dev
```

## Deployment

Deploy using Wrangler:

```bash
npm run deploy
```

Store the API key securely:

```bash
npx wrangler secret put OPENAI_API_KEY
```

## Future Improvements

- Teacher administration dashboard
- Student login system
- Automated Reading score calculation
- Listening answer analytics
- PDF score reports
- Speaking examination module
- Candidate progress tracking
- Improved anti-cheating features

## Screenshots

*(Add screenshots of the Reading, Listening, Writing, and Teacher Dashboard once available.)*

## Author

**Rudi van Vuuren**

- GitHub: https://github.com/CoderinaPurpr
- LinkedIn: https://www.linkedin.com/in/rudi-van-vuuren/

## Licence

This project is intended for educational purposes as part of software development and cloud computing coursework.
