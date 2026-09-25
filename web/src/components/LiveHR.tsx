import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './cadence/Button'
import { Card, CardHead } from './cadence/Card'
import { TrendChart } from './cadence/charts'

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
      <Card>
        <CardHead title="Live heart rate" />
        <p className="mt-2 text-caption text-ink-3">Not available in this browser.</p>
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
          : 'Could not connect.',
      )
    }
  }, [teardown])

  const disconnect = useCallback(() => {
    teardown()
    setStatus('idle')
    setBpm(null)
  }, [teardown])

  const now = Date.now()
  // Seconds ago (negative) as the x category, oldest first.
  const chartData = samples.map((s) => ({
    date: String(Math.round((s.t - now) / 1000)),
    value: s.bpm,
  }))

  return (
    <Card>
      <CardHead
        title="Live heart rate"
        action={
          status === 'connected' ? (
            <Button variant="ghost" size="sm" onClick={disconnect}>
              Disconnect
            </Button>
          ) : undefined
        }
      />
      {status === 'idle' || status === 'disconnected' ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-caption text-ink-3">Chest strap or broadcast mode.</p>
          <Button variant="tonal" onClick={connect} className="self-start">
            Connect monitor
          </Button>
          {status === 'disconnected' && (
            <p className="text-caption text-ink-3">Disconnected.</p>
          )}
          {error && <p className="text-caption text-rose-strong">{error}</p>}
        </div>
      ) : status === 'connecting' ? (
        <p className="mt-3 text-caption text-ink-3">Connecting</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-caption text-ink-3">
            {deviceName ?? 'Heart rate monitor'}
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="text-display-lg text-ink tabular-nums">
              {bpm ?? '—'}
            </span>
            <span className="text-title-sm text-ink-2">bpm</span>
          </p>
          {chartData.length > 1 ? (
            <TrendChart
              data={chartData}
              tone="effort"
              unit="bpm"
              height={180}
              formatX={(v) => `${v} s`}
              animate={false}
            />
          ) : (
            <p className="text-caption text-ink-3">Waiting for beats</p>
          )}
        </div>
      )}
    </Card>
  )
}
