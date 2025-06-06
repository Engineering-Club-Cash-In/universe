# memory_module.py
from supabase import create_client, Client
from typing import Optional
import os
import time

supabase_client: Optional[Client] = None

def initialize_memory(url, key):
    """Initializes the Supabase client."""
    global supabase_client
    if not url or url == "YOUR_SUPABASE_URL_HERE" or \
       not key or key == "YOUR_SUPABASE_SERVICE_KEY_HERE":
        raise ValueError("Supabase URL and Key are required and should not be placeholders.")
    supabase_client = create_client(url, key)
    print("Supabase memory initialized.")

def save_interaction(session_id, user_msg, ai_msg):
    """Saves a user-AI interaction to Supabase."""
    if supabase_client is None:
        raise Exception("Memory not initialized. Call initialize_memory() first.")
    
    db_start_time = time.time()
    try:
        # data, count = supabase_client.table('conversation_history').insert({ # Original V1 syntax
        response = supabase_client.table('conversation_history').insert({ # V2 syntax
            "session_id": session_id,
            "user_message": user_msg,
            "ai_message": ai_msg
        }).execute()
        
        db_time = time.time() - db_start_time
        print(f"💾 Database save completed in {db_time:.3f}s")
        
        # print(f"Interaction saved. Response: {response}") # For debugging
        if hasattr(response, 'data') and response.data:
            print("Interaction saved to Supabase.")
            return response.data
        return None # Fallback
    except Exception as e:
        db_time = time.time() - db_start_time
        print(f"💾 Database save error after {db_time:.3f}s: {e}")
        return None

def get_history(session_id, limit=5):
    """Retrieves conversation history for a session from Supabase."""
    if supabase_client is None:
        raise Exception("Memory not initialized. Call initialize_memory() first.")
    
    db_start_time = time.time()
    try:
        # Reduced limit for faster queries
        actual_limit = min(limit, 3)  # Max 3 conversations for speed
        
        response = supabase_client.table('conversation_history') \
            .select("user_message, ai_message") \
            .eq("session_id", session_id) \
            .order("created_at", desc=True) \
            .limit(actual_limit) \
            .execute()
        
        db_time = time.time() - db_start_time
        print(f"💾 Database query completed in {db_time:.3f}s")
        
        if hasattr(response, 'data') and response.data is not None:
             # The history needs to be in chronological order (oldest first) for the LLM
            result = response.data[::-1]
            print(f"💾 Retrieved {len(result)} conversation(s) from history")
            return result
        return [] # Fallback
    except Exception as e:
        db_time = time.time() - db_start_time
        print(f"💾 Database query error after {db_time:.3f}s: {e}")
        return []

# Example self-test (optional)
if __name__ == "__main__":
    MY_SUPABASE_URL = os.environ.get("SUPABASE_URL")
    SUPABASE_API_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

    if not MY_SUPABASE_URL or not SUPABASE_API_KEY:
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables to test memory_module.py.")
    else:
        try:
            initialize_memory(url=MY_SUPABASE_URL, key=SUPABASE_API_KEY)
            session_id = "test_session_002"
            save_interaction(session_id, "Hello AI, this is a test.", "Hello User! Test received.")
            save_interaction(session_id, "How is the weather in the cloud?", "It's always partly cloudy with a chance of data.")
            history = get_history(session_id)
            print("Retrieved history:", history)
        except Exception as e:
            print(f"Could not run memory example: {e}")