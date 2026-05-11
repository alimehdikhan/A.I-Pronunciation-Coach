# Create the complete project structure and code for the AI Pronunciation Coach

project_structure = """
pronunciation-coach/
├── backend/
│   ├── main.py              # FastAPI backend server
│   ├── models.py            # Model loading and inference
│   ├── pronunciation.py     # Pronunciation scoring logic
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── index.html          # Main HTML file
│   ├── styles.css          # CSS styling
│   └── script.js           # JavaScript for audio recording and API calls
└── README.md               # Setup instructions
"""

print("Project Structure:")
print(project_structure)
print("\n" + "="*80 + "\n")

# Display the files we'll create
files_to_create = [
    "backend/requirements.txt",
    "backend/main.py",
    "backend/models.py", 
    "backend/pronunciation.py",
    "frontend/index.html",
    "frontend/styles.css",
    "frontend/script.js",
    "README.md"
]

print("Files to be created:")
for file in files_to_create:
    print(f"  ✓ {file}")