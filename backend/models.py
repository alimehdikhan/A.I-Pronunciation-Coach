"""
Model Loading and Inference Module
Handles Whisper ASR model for speech recognition
"""

import whisper
import torch
from typing import Dict, Any

class WhisperASR:
    """Wrapper for OpenAI Whisper ASR model"""
    
    def __init__(self, model_size: str = "base"):
        """
        Initialize Whisper model
        
        Args:
            model_size: Model size - 'tiny', 'base', 'small', 'medium', 'large'
                       tiny: Fastest, less accurate (~1GB RAM)
                       base: Good balance (~1GB RAM) - RECOMMENDED
                       small: Better accuracy (~2GB RAM)
                       medium: High accuracy (~5GB RAM)
                       large: Best accuracy (~10GB RAM)
        """
        self.model_size = model_size
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"Loading Whisper {model_size} model on {self.device}...")
        self.model = whisper.load_model(model_size, device=self.device)
        print(f"Whisper {model_size} model loaded successfully!")
    
    def transcribe(self, audio_path: str, language: str = "en") -> Dict[str, Any]:
        """
        Transcribe audio file to text
        
        Args:
            audio_path: Path to audio file
            language: Language code (default: 'en' for English)
        
        Returns:
            Dictionary with transcription results
        """
        try:
            # Transcribe with Whisper
            result = self.model.transcribe(
                audio_path,
                language=language,
                task="transcribe",
                fp16=(self.device == "cuda")  # Use FP16 on GPU for speed
            )
            
            return {
                "text": result["text"],
                "segments": result.get("segments", []),
                "language": result.get("language", language)
            }
        
        except Exception as e:
            raise RuntimeError(f"Transcription failed: {str(e)}")
    
    def get_model_info(self) -> Dict[str, str]:
        """Get information about the loaded model"""
        return {
            "model_size": self.model_size,
            "device": self.device,
            "framework": "OpenAI Whisper"
        }
