import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';

const MB = 1024 * 1024;

@ApiTags('Health')
// Probes poll far more often than a user would; they must not consume the quota.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  @Get()
  // Returns the raw Terminus document, not the response envelope, so standard
  // monitoring tooling can read it.
  @SkipTransform()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check - database + memory' })
  check() {
    const heapMb = this.config.get<number>('app.healthHeapMb') ?? 512;
    const rssMb = this.config.get<number>('app.healthRssMb') ?? 1024;

    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.memory.checkHeap('memory_heap', heapMb * MB),
      () => this.memory.checkRSS('memory_rss', rssMb * MB),
    ]);
  }
}
