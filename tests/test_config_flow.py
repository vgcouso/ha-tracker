# test_config_flow.py
import pytest
from unittest.mock import AsyncMock, patch
from custom_components.ha_tracker.config_flow import HATrackerConfigFlow

@pytest.fixture
async def flow(hass):
    """Fixture para instanciar HATrackerConfigFlow."""
    flow = HATrackerConfigFlow()
    flow.hass = hass
    return flow

@pytest.mark.asyncio
@patch("custom_components.ha_tracker.config_flow.HATrackerConfigFlow.async_create_entry")
async def test_async_step_user(create_entry_mock, flow):
    """Prueba el paso async_step_user del flujo de configuración."""
    user_input = {'update_interval': 10}
    create_entry_mock.return_value = {'type': 'create_entry', 'data': user_input}
    result = await flow.async_step_user(user_input=user_input)
    assert result['type'] == 'create_entry'
