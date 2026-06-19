#!/usr/bin/env python3
"""
Test script to verify SkillsRegistry functionality.
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the parent directory of hermes_agent to the path
hermes_agent_path = Path(__file__).parent / "Hermes-USB-Portable-main" / "src"
sys.path.insert(0, str(hermes_agent_path))

# Now import from the hermes_agent package
from hermes_agent.skills_registry import SkillsRegistry, SkillContext

async def test_skills_registry():
    """Test the SkillsRegistry implementation."""
    print("Testing SkillsRegistry...")
    
    # Create a SkillsRegistry instance
    portable_root = Path(__file__).parent / "Hermes-USB-Portable-main"
    registry = SkillsRegistry(portable_root=portable_root)
    
    # Check what skills were loaded
    skills = registry.list_all()
    print(f"Loaded skills: {skills}")
    
    # Test getting a specific skill
    if "hello_world" in skills:
        skill_info = registry.get("hello_world")
        print(f"Hello World skill info: {skill_info['meta']}")
        
        # Test invoking the skill
        context = SkillContext(
            portable_root=portable_root,
            session_id="test_session",
            logger=skill_info["module"].logger if hasattr(skill_info["module"], 'logger') else None
        )
        
        result = await registry.invoke("hello_world", {"name": "Tester"}, context)
        print(f"Skill invocation result: {result}")
        
        # Test with default parameter
        result2 = await registry.invoke("hello_world", {}, context)
        print(f"Skill invocation result (default): {result2}")
    else:
        print("ERROR: hello_world skill not found!")
        print(f"Available skills: {skills}")
        return False
    
    # Clean up
    registry.stop_watching()
    print("SkillsRegistry test completed successfully!")
    return True

if __name__ == "__main__":
    try:
        success = asyncio.run(test_skills_registry())
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)