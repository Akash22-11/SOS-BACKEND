import { haversineDistance, findNearbyInDB } from '../src/services/hospitalFinderService';

jest.mock('../src/models/Hospital');
import { find } from '../src/models/Hospital';

describe('haversineDistance', () => {
  test('same point returns 0', () => {
    expect(haversineDistance([88.5, 23.4], [88.5, 23.4])).toBe(0);
  });

  test('Krishnanagar to Kolkata ≈ 100 km', () => {
    // Krishnanagar: 88.498, 23.400  |  Kolkata: 88.363, 22.572
    const dist = haversineDistance([88.498, 23.400], [88.363, 22.572]);
    expect(dist).toBeGreaterThan(90000);
    expect(dist).toBeLessThan(110000);
  });

  test('1 degree latitude ≈ 111 km', () => {
    const dist = haversineDistance([0, 0], [0, 1]);
    expect(dist).toBeGreaterThan(110000);
    expect(dist).toBeLessThan(112000);
  });
});

describe('findNearbyInDB', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns hospitals sorted by distance', async () => {
    const mockHospitals = [
      { _id: 'h1', name: 'Near Hospital',  location: { coordinates: [88.5, 23.4] } },
      { _id: 'h2', name: 'Far Hospital',   location: { coordinates: [88.6, 23.5] } }
    ];

    find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue(mockHospitals)
      })
    });

    const result = await findNearbyInDB([88.498, 23.400]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Near Hospital');
  });

  test('returns empty array when no hospitals in range', async () => {
    find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([])
      })
    });

    const result = await findNearbyInDB([88.498, 23.400]);
    expect(result).toHaveLength(0);
  });
});
