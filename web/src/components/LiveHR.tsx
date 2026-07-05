import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from './ui'

// Web Bluetooth is missing from lib.dom in this TS setup — declare just the
// narrow surface we touch, no `any`, no new dependencies.
interface BluetoothCharacteristicLike extends EventTarget {
  startNotifications(): Promise<BluetoothCharacteristicLike>
  stopNotifications(): Promise<BluetoothCharacteristicLike>
  readonly value?: DataView
}
interface BluetoothServiceLike {
  getCharacteristic(name: string): Promise<BluetoothCharacteristicLike>
}
interface BluetoothGATTLike {
  connect(): Promise<BluetoothGATTLike>
  disconnect(): void
  getPrimaryService(name: string): Promise<BluetoothServiceLike>
  readonly connected: boolean
}
interface BluetoothDeviceLike extends EventTarget {
  readonly name?: string
  readonly gatt?: BluetoothGATTLike
}
interface BluetoothLike {
  requestDevice(options: {
    filters: { services: string[] }[]
  }): Promise<BluetoothDeviceLike>
}

function getBluetooth(): BluetoothLike | undefined {
  return (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth
}

// Bluetooth Heart Rate Measurement: byte 0 = flags; bit 0 picks uint8 vs
// uint16 (little-endian) for the value that follows at offset 1.
function parseHeartRate(value: DataView): number | null {
  if (value.byteLength < 2) return null
  const flags = value.getUint8(0)
  return flags & 0x1 ? value.getUint16(1, true) : value.getUint8(1)
}

// Copied from Workouts.tsx to keep this card self-contained.
const secondaryButton =
  'rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 ' +
  'hover:border-neutral-500'

const tickStyle = { fill: '#737373', fontSize: 11 }
const tooltipStyle = {
  backgroundColor: '#171717',
  border: '1px solid #404040',
  borderRadius: 8,
  fontSize: 12,
}

const WINDOW_MS = 3 * 60 * 1000 // rolling ~3-minute chart window

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected'

interface Sample {
  t: number // epoch ms
  bpm: number
}

export function LiveHR() {
  const supported = typeof navigator !== 'undefined' && !!getBluetooth()

  if (!supported) {
    return (
      <Card title="Live heart rate">
        <p className="text-sm text-neutral-500">
          Live HR needs Web Bluetooth — use Chrome or Edge on desktop or
          Android, and turn on your strap&rsquo;s Broadcast Heart Rate mode.
          This browser doesn&rsquo;t support it.
        </p>
      </Card>
    )
  }

  return <LiveHRConnected />
}

function LiveHRConnected() {
  const [status, setStatus] = useState<Status>('idle')
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [error, setError] = useState<string | null>(null)

  // Kept in refs so unmount cleanup and disconnect don't leak listeners.
  const deviceRef = useRef<BluetoothDeviceLike | null>(null)
  const characteristicRef = useRef<BluetoothCharacteristicLike | null>(null)
  const onValueRef = useRef<((event: Event) => void) | null>(null)
  const onDisconnectRef = useRef<(() => void) | null>(null)

  const teardown = useCallback(() => {
    const characteristic = characteristicRef.current
    const onValue = onValueRef.current
    if (characteristic && onValue) {
      characteristic.removeEventListener('characteristicvaluechanged', onValue)
      characteristic.stopNotifications().catch(() => {})
    }
    const device = deviceRef.current
    const onDisconnect = onDisconnectRef.current
    if (device && onDisconnect) {
      device.removeEventListener('gattserverdisconnected', onDisconnect)
    }
    if (device?.gatt?.connected) device.gatt.disconnect()
    characteristicRef.current = null
    onValueRef.current = null
    onDisconnectRef.current = null
    deviceRef.current = null
  }, [])

  // Clean up on unmount only — teardown is stable.
  useEffect(() => teardown, [teardown])

  const connect = useCallback(async () => {
    const bluetooth = getBluetooth()
    if (!bluetooth) return
    setError(null)
    setStatus('connecting')
    try {
      const device = await bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      })
      deviceRef.current = device
      setDeviceName(device.name ?? 'Heart rate monitor')

      const gatt = device.gatt
      if (!gatt) throw new Error('no-gatt')
      const server = await gatt.connect()
      const service = await server.getPrimaryService('heart_rate')
      const characteristic = await service.getCharacteristic(
        'heart_rate_measurement',
      )

      const onValue = (event: Event) => {
        const target = event.target as BluetoothCharacteristicLike | null
        const value = target?.value
        if (!value) return
        const hr = parseHeartRate(value)
        if (hr == null) return
        setBpm(hr)
        const now = Date.now()
        setSamples((prev) =>
          [...prev, { t: now, bpm: hr }].filter((s) => now - s.t <= WINDOW_MS),
        )
      }
      const onDisconnect = () => {
        teardown()
        setStatus('disconnected')
        setBpm(null)
      }

      characteristic.addEventListener('characteristicvaluechanged', onValue)
      device.addEventListener('gattserverdisconnected', onDisconnect)
      characteristicRef.current = characteristic
      onValueRef.current = onValue
      onDisconnectRef.current = onDisconnect

      await characteristic.startNotifications()
      setSamples([])
      setStatus('connected')
    } catch (err) {
      teardown()
      setStatus('idle')
      const name = (err as { name?: string }).name
      setError(
        name === 'NotFoundError'
          ? 'No monitor selected.'
          : 'Could not connect to a heart rate monitor.',
      )
    }
  }, [teardown])

  const disconnect = useCallback(() => {
    teardown()
    setStatus('idle')
    setBpm(null)
  }, [teardown])

  const now = Date.now()
  const chartData = samples.map((s) => ({
    ago: Math.round((s.t - now) / 1000), // seconds-ago (negative)
    bpm: s.bpm,
  }))

  return (
    <Card title="Live heart rate">
      {status === 'idle' || status === 'disconnected' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <button className={secondaryButton} onClick={connect}>
              Connect HR monitor
            </button>
            {status === 'disconnected' && (
              <span className="text-xs text-neutral-500">disconnected</span>
            )}
          </div>
          <p className="text-xs text-neutral-600">
            Pairs with any BLE chest strap, or a WHOOP with Broadcast Heart
            Rate enabled.
          </p>
          {error && <p className="text-xs text-neutral-500">{error}</p>}
        </div>
      ) : status === 'connecting' ? (
        <p className="py-6 text-center text-sm text-neutral-500">Connecting…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {deviceName ?? 'Heart rate monitor'}
            </span>
            <button className={secondaryButton} onClick={disconnect}>
              Disconnect
            </button>
          </div>
          <div className="text-center">
            <span className="font-mono text-6xl tabular-nums text-teal-300">
              {bpm ?? '—'}
            </span>
            <span className="ml-2 text-sm text-neutral-500">bpm</span>
          </div>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart
                data={chartData}
                margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
              >
                <CartesianGrid
                  stroke="#262626"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="ago"
                  type="number"
                  domain={['dataMin', 0]}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}s`}
                  minTickGap={32}
                />
                <YAxis
                  width={40}
                  domain={['auto', 'auto']}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: '#d4d4d4' }}
                  formatter={(value) => [`${value} bpm`, 'HR']}
                  labelFormatter={(label) => `${label}s`}
                />
                <Line
                  type="monotone"
                  dataKey="bpm"
                  stroke="#2dd4bf"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-4 text-center text-sm text-neutral-600">
              Waiting for beats…
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
