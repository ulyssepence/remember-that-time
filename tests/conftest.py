import pathlib
import dotenv
import pytest

dotenv.load_dotenv(pathlib.Path(__file__).parent.parent / ".env")

DATA_DIR = pathlib.Path(__file__).parent.parent / "data" / "sample"


@pytest.fixture
def data_dir():
    return DATA_DIR


@pytest.fixture
def sample_video(data_dir):
    candidates = list(data_dir.glob("*.mp4"))
    if not candidates:
        pytest.skip("No sample video in data/sample/")
    return candidates[0]
