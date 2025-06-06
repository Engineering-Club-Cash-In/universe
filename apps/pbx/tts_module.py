# tts_module.py
from google.cloud import texttospeech
import os
import time
import json
from google.oauth2 import service_account

client = None
google_voice = None

def initialize_tts():
    """Initializes the Google Cloud Text-to-Speech client."""
    global client, google_voice
    
    print("🚀 Initializing Google Cloud Text-to-Speech...")
    
    try:
        # Path to the service account credentials
        credentials_path = "google_credentials.json"
        
        if not os.path.exists(credentials_path):
            raise Exception(f"Google credentials file not found: {credentials_path}")
        
        # Load credentials from service account file
        credentials = service_account.Credentials.from_service_account_file(
            credentials_path,
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        
        # Initialize the client
        start_time = time.time()
        client = texttospeech.TextToSpeechClient(credentials=credentials)
        
        # Set up voice configuration - using high-quality Spanish voice
        google_voice = texttospeech.VoiceSelectionParams(
            language_code="es-US",  # Spanish (US)
            name="es-US-Chirp3-HD-Achernar",  # High-quality Chirp3-HD voice (female)
            ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
        )
        
        load_time = time.time() - start_time
        
        print(f"✅ Google Cloud TTS initialized successfully in {load_time:.2f}s")
        print(f"🎭 Voice: Spanish Chirp3-HD (es-US-Chirp3-HD-Achernar)")
        print(f"🌎 Region: US Spanish (High Quality)")
        print(f"⚡ Speed: Cloud-based Chirp3-HD synthesis")
        print(f"🔧 Backend: Google Cloud Platform")
        print(f"🔊 Audio: Optimized for Bluetooth speakers")
        
        # Test the service with a simple synthesis
        print("🔥 Testing Google TTS connection...")
        test_start = time.time()
        test_input = texttospeech.SynthesisInput(text="Hola")
        test_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            effects_profile_id=["small-bluetooth-speaker-class-device"]
        )
        
        response = client.synthesize_speech(
            input=test_input, 
            voice=google_voice, 
            audio_config=test_config
        )
        
        test_time = time.time() - test_start
        print(f"🏃 Connection test completed in {test_time:.3f}s - ready for synthesis!")
        
        return True
        
    except Exception as e:
        print(f"❌ Error initializing Google Cloud TTS: {e}")
        print("💡 Troubleshooting:")
        print("   - Check google_credentials.json exists and is valid")
        print("   - Verify Google Cloud Text-to-Speech API is enabled")
        print("   - Ensure billing is set up in Google Cloud Console")
        print("   - Check internet connection")
        raise

def generate_speech(text, output_filename="output.wav", speaker_wav=None, speed_mode=True, ultra_fast=False):
    """
    Generates speech from text using Google Cloud Text-to-Speech.
    Args:
        text (str): The text to synthesize.
        output_filename (str): The path to save the output WAV file.
        speaker_wav (str, optional): Ignored in Google TTS.
        speed_mode (bool): Ignored (Google TTS is always optimized).
        ultra_fast (bool): If True, uses Standard voice for faster synthesis.
    Returns:
        str: Path to the saved audio file.
    """
    if client is None:
        raise Exception("Google Cloud TTS not initialized. Call initialize_tts() first.")

    print(f"🗣️ Generating speech: '{text[:50]}{'...' if len(text) > 50 else ''}'")
    
    try:
        start_time = time.time()
        
        # Ensure the directory exists
        output_dir = os.path.dirname(output_filename)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)
            print(f"📁 Created directory: {output_dir}")
        
        # Choose voice quality based on ultra_fast mode
        if ultra_fast:
            # Use Chirp HD voice for faster synthesis (still high quality)
            voice = texttospeech.VoiceSelectionParams(
                language_code="es-US",
                name="es-US-Chirp-HD-F",  # Chirp HD voice (faster than Chirp3-HD)
                ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
            )
            print("⚡ Using Chirp HD voice for ultra-fast mode")
        else:
            # Use Neural voice for high quality
            voice = google_voice
            print("🎵 Using Neural voice for high quality")
        
        # Prepare the text input
        text_input = texttospeech.SynthesisInput(text=text)
        
        # Configure audio output with Bluetooth speaker optimization
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16,
            sample_rate_hertz=22050,  # Good quality, reasonable file size
            speaking_rate=1.0,        # Normal speed
            pitch=0.0,                # Normal pitch
            effects_profile_id=["small-bluetooth-speaker-class-device"]  # Optimized for small Bluetooth speakers
        )
        
        # Generate speech
        print("🎵 Synthesizing audio with Google Cloud...")
        synthesis_start = time.time()
        
        response = client.synthesize_speech(
            input=text_input,
            voice=voice,
            audio_config=audio_config
        )
        
        synthesis_time = time.time() - synthesis_start
        
        # Save the audio to file
        print("💾 Saving audio file...")
        with open(output_filename, "wb") as out:
            out.write(response.audio_content)
        
        total_time = time.time() - start_time
        file_size = os.path.getsize(output_filename)
        
        # Estimate audio duration (22050 Hz, 16-bit, mono)
        audio_duration = len(response.audio_content) / (22050 * 2)  # bytes / (sample_rate * bytes_per_sample)
        
        print(f"✅ Speech generated successfully!")
        print(f"🎵 Saved: {output_filename} ({file_size} bytes, {audio_duration:.1f}s audio)")
        print(f"⏱️ Synthesis time: {synthesis_time:.3f}s")
        print(f"⏱️ Total time: {total_time:.3f}s")
        print(f"🚀 Speed: {audio_duration/synthesis_time:.1f}x realtime (synthesis only)")
        
        return output_filename
        
    except Exception as e:
        print(f"❌ Error in speech generation: {e}")
        if "quota" in str(e).lower():
            print("💡 Quota exceeded - try using ultra_fast=True or check Google Cloud billing")
        elif "permission" in str(e).lower():
            print("💡 Permission denied - check Google Cloud TTS API is enabled")
        elif "network" in str(e).lower():
            print("💡 Network error - check internet connection")
        raise

def generate_speech_chunked(text, output_dir="static", session_id="default", speaker_wav=None):
    """
    Generate speech in chunks for faster perceived response time with Google TTS.
    """
    if client is None:
        raise Exception("Google Cloud TTS not initialized. Call initialize_tts() first.")
    
    # Split text into sentences for chunking
    import re
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    if len(sentences) <= 1:
        # Single sentence, no need to chunk
        output_file = os.path.join(output_dir, f"speech_{session_id}.wav")
        return [generate_speech(text, output_file, ultra_fast=True)]
    
    print(f"📝 Generating {len(sentences)} chunks with Google Cloud TTS...")
    audio_files = []
    
    for i, sentence in enumerate(sentences):
        if len(sentence) < 3:  # Skip very short fragments
            continue
            
        chunk_filename = f"chunk_{session_id}_{i:03d}.wav"
        chunk_path = os.path.join(output_dir, chunk_filename)
        
        try:
            generate_speech(sentence, chunk_path, ultra_fast=True)
            audio_files.append(chunk_path)
        except Exception as e:
            print(f"❌ Error generating chunk {i}: {e}")
    
    print(f"✅ Generated {len(audio_files)} audio chunks with Google Cloud TTS")
    return audio_files

def list_available_voices():
    """List available Spanish voices from Google Cloud TTS."""
    if client is None:
        print("⚠️ Client not initialized. Call initialize_tts() first.")
        return
    
    print("🎭 Listing available Spanish voices from Google Cloud TTS...")
    
    try:
        # Request available voices
        voices = client.list_voices()
        
        spanish_voices = []
        for voice in voices.voices:
            for language_code in voice.language_codes:
                if language_code.startswith('es'):
                    spanish_voices.append({
                        'name': voice.name,
                        'language': language_code,
                        'gender': voice.ssml_gender.name,
                        'type': 'Neural' if 'Neural' in voice.name else 'Standard'
                    })
        
        print(f"\n📋 Found {len(spanish_voices)} Spanish voices:")
        print("-" * 70)
        for voice in spanish_voices:
            print(f"{voice['language']:8} | {voice['name']:25} | {voice['gender']:8} | {voice['type']}")
        
        print("\n💡 Recommended voices:")
        print("   🇪🇸 es-ES-Neural2-C (Spain - Female, High Quality)")
        print("   🇲🇽 es-MX-Neural2-A (Mexico - Female)")
        print("   🇦🇷 es-AR-Neural2-A (Argentina - Female)")
        
    except Exception as e:
        print(f"❌ Error listing voices: {e}")

def set_voice(language_code="es-ES", voice_name="es-ES-Neural2-C", gender="FEMALE"):
    """
    Set a different voice configuration.
    Args:
        language_code (str): Language code (e.g., 'es-ES', 'es-MX', 'es-AR')
        voice_name (str): Specific voice name
        gender (str): Voice gender ('MALE', 'FEMALE', 'NEUTRAL')
    """
    global google_voice
    
    if client is None:
        print("⚠️ Client not initialized. Call initialize_tts() first.")
        return
    
    try:
        # Convert gender string to enum
        gender_map = {
            'MALE': texttospeech.SsmlVoiceGender.MALE,
            'FEMALE': texttospeech.SsmlVoiceGender.FEMALE,
            'NEUTRAL': texttospeech.SsmlVoiceGender.NEUTRAL
        }
        
        google_voice = texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name=voice_name,
            ssml_gender=gender_map.get(gender.upper(), texttospeech.SsmlVoiceGender.FEMALE)
        )
        
        print(f"✅ Voice updated: {voice_name} ({language_code}, {gender})")
        
    except Exception as e:
        print(f"❌ Error setting voice: {e}")
