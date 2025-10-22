"""
Unit tests for clinic_agents module initialization.

Tests the lazy imports and module attribute access.
"""

import pytest
from unittest.mock import Mock, patch


class TestClinicAgentsInit:
    """Test clinic_agents module initialization and lazy imports."""

    def test_lazy_import_agents_not_available(self):
        """Test __getattr__ when agents package is not available."""
        # Import the module
        import clinic_agents

        with patch('importlib.util.find_spec') as mock_find_spec:
            # Mock find_spec to return None (package not found)
            mock_find_spec.return_value = None

            # This should raise AttributeError
            with pytest.raises(AttributeError, match="module 'clinic_agents' has no attribute 'Agent'"):
                _ = clinic_agents.Agent

    def test_lazy_import_agents_available_but_not_site_packages(self):
        """Test __getattr__ when agents package exists but not in site-packages."""
        import clinic_agents

        with patch('importlib.util.find_spec') as mock_find_spec, \
             patch('importlib.util.module_from_spec') as mock_module_from_spec:

            # Mock spec that exists but not in site-packages
            mock_spec = Mock()
            mock_spec.origin = "/some/other/path/agents/__init__.py"
            mock_spec.loader = Mock()
            mock_find_spec.return_value = mock_spec

            mock_module = Mock()
            mock_module_from_spec.return_value = mock_module

            # This should raise AttributeError since it's not in site-packages
            with pytest.raises(AttributeError, match="module 'clinic_agents' has no attribute 'Agent'"):
                _ = clinic_agents.Agent

    def test_lazy_import_agents_available_and_has_attribute(self):
        """Test __getattr__ when agents package is available and has the requested attribute."""
        import clinic_agents

        with patch('importlib.util.find_spec') as mock_find_spec, \
             patch('importlib.util.module_from_spec') as mock_module_from_spec:

            # Mock spec in site-packages
            mock_spec = Mock()
            mock_spec.origin = "/usr/local/lib/python3.12/site-packages/agents/__init__.py"
            mock_spec.loader = Mock()
            mock_find_spec.return_value = mock_spec

            mock_module = Mock()
            mock_module.Agent = "MockAgentClass"
            mock_module_from_spec.return_value = mock_module

            # This should return the attribute
            result = clinic_agents.Agent
            assert result == "MockAgentClass"

    def test_lazy_import_sqlalchemysession_special_case(self):
        """Test __getattr__ for SQLAlchemySession special case."""
        import clinic_agents

        # This should return None for SQLAlchemySession
        result = clinic_agents.SQLAlchemySession
        assert result is None

    def test_lazy_import_nonexistent_attribute(self):
        """Test __getattr__ for attributes that don't exist in agents package."""
        import clinic_agents

        with patch('importlib.util.find_spec') as mock_find_spec, \
             patch('importlib.util.module_from_spec') as mock_module_from_spec:

            # Mock spec in site-packages
            mock_spec = Mock()
            mock_spec.origin = "/usr/local/lib/python3.12/site-packages/agents/__init__.py"
            mock_spec.loader = Mock()
            mock_find_spec.return_value = mock_spec

            # Mock module that doesn't have the NonExistentAttribute
            mock_module = Mock()
            # Ensure hasattr returns False for this attribute
            del mock_module.NonExistentAttribute  # Remove any default attribute
            mock_module_from_spec.return_value = mock_module

            # This should raise AttributeError since the attribute doesn't exist
            with pytest.raises(AttributeError, match="module 'clinic_agents' has no attribute 'NonExistentAttribute'"):
                _ = clinic_agents.NonExistentAttribute

    def test_version_attribute(self):
        """Test that the module has a version attribute."""
        import clinic_agents
        assert hasattr(clinic_agents, '__version__')
        assert clinic_agents.__version__ == "1.0.0"
